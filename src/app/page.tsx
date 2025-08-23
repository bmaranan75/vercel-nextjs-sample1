'use client';

import { useState } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userName, setUserName] = useState<string>('');
  const [showNameInput, setShowNameInput] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  const handleSignIn = () => {
    setShowNameInput(true);
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userName.trim()) {
      setShowNameInput(false);
      setIsSignedIn(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

      if (!response.ok) throw new Error('Failed to send message');

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
          content: 'Sorry, there was an error processing your message.',
        })
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 min-h-screen">
      {/* Name Input Modal Overlay */}
      {showNameInput && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg shadow-lg border max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-center mb-4">Sign In to AI Chat</h2>
            <p className="text-gray-600 text-center mb-6">Please enter your name to continue</p>
            <form onSubmit={handleNameSubmit}>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                required
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowNameInput(false)}
                  className="flex-1 bg-gray-500 text-white p-3 rounded-lg hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-500 text-white p-3 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Sign In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Chat Interface */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-center mb-2">AI Chat</h1>
        <p className="text-gray-600 text-center">Chat with OpenAI GPT-4o Mini</p>
      </div>

      <div className="border rounded-lg overflow-hidden mb-4 bg-white shadow-sm">
        {/* Chat Header */}
        <div className="bg-blue-500 text-white px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            {isSignedIn ? (
              <div className="flex items-center">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center mr-3">
                  <span className="text-sm font-semibold">{userName.charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <h3 className="font-semibold">{userName}</h3>
                  <p className="text-blue-100 text-sm">Online</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center mr-3">
                  <span className="text-sm font-semibold">?</span>
                </div>
                <div>
                  <h3 className="font-semibold">Guest User</h3>
                  <p className="text-blue-100 text-sm">Not signed in</p>
                </div>
              </div>
            )}
            <button
              onClick={handleSignIn}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1 rounded transition-colors"
            >
              {isSignedIn ? 'Switch User' : 'Sign In'}
            </button>
          </div>
        </div>

        {/* Chat Messages */}
        <div className="h-96 overflow-y-auto p-4 bg-gray-50">
          {messages.length === 0 && (
            <p className="text-gray-500 text-center">Start a conversation...</p>
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
                  {message.role === 'user' ? (isSignedIn ? userName : 'Guest') : 'AI'}
                </p>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="text-left">
              <div className="inline-block max-w-xs lg:max-w-md px-4 py-2 rounded-lg bg-white text-gray-800 border">
                <p className="text-sm font-medium mb-1">AI</p>
                <p>Thinking...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="flex-1 p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={input}
          placeholder="Type your message..."
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
