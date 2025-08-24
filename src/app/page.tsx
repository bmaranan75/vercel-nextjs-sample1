'use client';

import { useUser } from '@auth0/nextjs-auth0/client';
import { useState } from 'react';
import Image from 'next/image';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function Chat() {
  const { user, error, isLoading: userLoading } = useUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent submission if user is not authenticated
    if (!user) {
      alert('Please sign in to use the chat.');
      return;
    }
    
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(msg => ({ role: msg.role, content: msg.content })),
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required. Please sign in to use the chat.');
        }
        throw new Error('Failed to send message');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (reader) {
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          
          if (value) {
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') break;
                
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.content) {
                    setMessages(prev => 
                      prev.map(msg => 
                        msg.id === assistantMessage.id 
                          ? { ...msg, content: msg.content + parsed.content }
                          : msg
                      )
                    );
                  }
                } catch (error) {
                  console.error('Error parsing chunk:', error);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => 
        prev.slice(0, -1).concat({
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: error instanceof Error ? error.message : 'Sorry, there was an error processing your message.',
        })
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 min-h-screen">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-center mb-2">AI Chat</h1>
        <p className="text-gray-600 text-center">Chat with OpenAI GPT-4o Mini</p>
      </div>

      <div className="border rounded-lg overflow-hidden mb-4 bg-white shadow-sm">
        {/* Chat Header with Authentication */}
        <div className="bg-blue-500 text-white px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center mr-3 overflow-hidden">
                {user?.picture ? (
                  <Image 
                    src={user.picture} 
                    alt={user.name || 'User'} 
                    width={32}
                    height={32}
                    className="rounded-full"
                  />
                ) : (
                  <span className="text-sm font-semibold">
                    {user ? (user.name || user.email || 'U').charAt(0).toUpperCase() : '👤'}
                  </span>
                )}
              </div>
              <div>
                <h3 className="font-semibold">
                  {user ? (user.name || user.email) : 'Guest User'}
                </h3>
                <p className="text-blue-100 text-sm">
                  {userLoading ? 'Loading...' : user ? 'Authenticated' : 'Not signed in'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {error && (
                <span className="text-xs bg-red-500 px-2 py-1 rounded">
                  Auth Error
                </span>
              )}
              {user ? (
                <button
                  onClick={() => window.location.href = '/api/auth/logout'}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1 rounded transition-colors"
                >
                  Sign Out
                </button>
              ) : (
                <button
                  onClick={() => window.location.href = '/api/auth/login'}
                  className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1 rounded transition-colors"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Chat Messages */}
        <div className="h-96 overflow-y-auto p-4 bg-gray-50">
          {messages.length === 0 && (
            <div className="text-center text-gray-500">
              {user ? (
                <>
                  <p className="mb-2">
                    Welcome to AI Chat, {user.name || user.email}! 👋
                  </p>
                  <p>Start a conversation with our AI assistant...</p>
                </>
              ) : (
                <>
                  <p className="mb-2">Welcome to AI Chat! 👋</p>
                  <p className="text-orange-600 font-medium mb-2">
                    🔒 Authentication Required
                  </p>
                  <p className="text-sm">
                    Please sign in to start chatting with our AI assistant.
                  </p>
                  <p className="text-xs mt-2 text-blue-600">
                    Only authenticated users can access the chat for security and personalization.
                  </p>
                </>
              )}
            </div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={`mb-4 ${message.role === 'user' ? 'text-right' : 'text-left'}`}>
              <div
                className={`inline-block max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-800 border'
                }`}
              >
                <p className="text-sm font-medium mb-1">
                  {message.role === 'user' ? (user?.name || user?.email || 'You') : 'AI Assistant'}
                </p>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="text-left">
              <div className="inline-block max-w-xs lg:max-w-md px-4 py-2 rounded-lg bg-white text-gray-800 border">
                <p className="text-sm font-medium mb-1">AI Assistant</p>
                <div className="flex items-center">
                  <div className="animate-pulse flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                  </div>
                  <span className="ml-2 text-sm text-gray-500">Thinking...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="flex-1 p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          value={input}
          placeholder={user ? "Type your message..." : "Please sign in to use the chat"}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading || !user}
        />
        <button
          type="submit"
          disabled={isLoading || !user}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}
