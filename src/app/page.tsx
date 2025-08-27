'use client';

import { useUser } from '@auth0/nextjs-auth0/client';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  needsCalendarAuth?: boolean;
  tableData?: {
    headers: string[];
    rows: string[][];
    title?: string;
    summary?: string;
  };
}

export default function Chat() {
  const { user, error, isLoading: userLoading } = useUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Function to scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Initialize popup authorization function
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.openAuth0Popup = (popupRequestId?: string): Promise<any> => {
        if (!user?.sub) {
          console.error('User not authenticated');
          return Promise.reject(new Error('User not authenticated'));
        }

        const state = popupRequestId 
          ? JSON.stringify({ action: 'popup_checkout', userId: user.sub, popupRequestId })
          : JSON.stringify({ action: 'popup_checkout', userId: user.sub });

        const authUrl = `https://dev-ykxaa4dq35hmxhe2.us.auth0.com/authorize?` +
          `response_type=code&` +
          `client_id=eoACM0hNvrAPPyVMtaHaKlUszRVYXz9X&` +
          `redirect_uri=${encodeURIComponent('http://localhost:3000/auth-success')}&` +
          `scope=openid profile email&` +
          `audience=${encodeURIComponent('http://localhost:5000/api/checkout')}&` +
          `state=${encodeURIComponent(state)}`;

        const popup = window.open(
          authUrl,
          'auth0Popup',
          'width=500,height=600,scrollbars=yes,resizable=yes'
        );

        return new Promise((resolve, reject) => {
          const checkClosed = setInterval(() => {
            if (popup?.closed) {
              clearInterval(checkClosed);
              reject(new Error('Popup was closed by user'));
            }
          }, 1000);

          const messageListener = (event: MessageEvent) => {
            console.log('Received message in popup listener:', event.data);
            if (event.origin !== window.location.origin) {
              console.log('Message origin mismatch:', event.origin, 'vs', window.location.origin);
              return;
            }
            
            if (event.data.type === 'AUTH_SUCCESS') {
              console.log('Processing AUTH_SUCCESS');
              clearInterval(checkClosed);
              popup?.close();
              window.removeEventListener('message', messageListener);
              
              // Process checkout completion
              console.log('Calling checkout completion API');
              fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  action: 'popup_checkout_complete',
                  userId: user.sub,
                  code: event.data.code,
                  state: event.data.state,
                  popupRequestId: popupRequestId
                })
              })
              .then(response => {
                console.log('Checkout response:', response);
                return response.json();
              })
              .then(result => {
                console.log('Checkout result:', result);
                resolve(result);
              })
              .catch(error => {
                console.error('Checkout error:', error);
                reject(error);
              });
              
            } else if (event.data.type === 'AUTH_ERROR') {
              console.log('Processing AUTH_ERROR:', event.data.error);
              clearInterval(checkClosed);
              popup?.close();
              window.removeEventListener('message', messageListener);
              reject(new Error(event.data.error || 'Authentication failed'));
            }
          };
          
          window.addEventListener('message', messageListener);
        });
      };
    }

    // Cleanup on unmount
    return () => {
      if (typeof window !== 'undefined') {
        delete window.openAuth0Popup;
      }
    };
  }, [user]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Focus the input when user is authenticated and not loading
  useEffect(() => {
    if (user && !isLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [user, isLoading]);

  // Handle clearing chat history
  const handleClearChat = () => {
    setMessages([]);
    // Refocus the input after clearing
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);
  };

  // Handle Google Calendar authorization
  const handleGoogleAuth = async () => {
    if (!user?.sub) return;

    try {
      // Get the authorization URL
      const response = await fetch(`/api/auth/google?userId=${encodeURIComponent(user.sub)}`);
      const data = await response.json();
      
      if (data.authUrl) {
        // Open popup window for authorization
        const popup = window.open(
          data.authUrl,
          'googleAuth',
          'width=500,height=600,scrollbars=yes,resizable=yes'
        );

        // Listen for popup close or message
        const checkClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkClosed);
            // Add a message indicating the user should try their calendar request again
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: '✅ Authorization window closed. Please try your calendar request again!'
            }]);
          }
        }, 1000);

        // Listen for authorization success message
        const messageListener = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          
          if (event.data.type === 'GOOGLE_AUTH_SUCCESS') {
            clearInterval(checkClosed);
            popup?.close();
            window.removeEventListener('message', messageListener);
            
            // Add success message
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: '✅ Google Calendar access granted successfully! You can now ask about your calendar events.'
            }]);
          } else if (event.data.type === 'GOOGLE_AUTH_ERROR') {
            clearInterval(checkClosed);
            popup?.close();
            window.removeEventListener('message', messageListener);
            
            // Add error message
            const errorMessage = event.data.error === 'denied' 
              ? '❌ Google Calendar access was denied. Please try again if you want to view your calendar events.'
              : '❌ There was an error during Google Calendar authorization. Please try again.';
              
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: errorMessage
            }]);
          }
        };
        
        window.addEventListener('message', messageListener);
      }
    } catch (error) {
      console.error('Error initiating Google auth:', error);
    }
  };

  // Render message content with special handling for calendar auth and tables
  const renderMessageContent = (message: Message) => {
    // Handle calendar auth button
    if (message.needsCalendarAuth && message.content.includes('{{CALENDAR_AUTH_BUTTON}}')) {
      const parts = message.content.split('{{CALENDAR_AUTH_BUTTON}}');
      return (
        <div>
          <p className="whitespace-pre-wrap text-sm">{parts[0]}</p>
          <button
            onClick={handleGoogleAuth}
            className="my-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Grant Google Calendar Access
          </button>
          <p className="whitespace-pre-wrap text-sm">{parts[1]}</p>
        </div>
      );
    }

    // Handle table data
    if (message.tableData) {
      return (
        <div>
          {message.tableData.title && (
            <h4 className="font-semibold mb-2 text-sm text-gray-800">{message.tableData.title}</h4>
          )}
          
          <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm w-full">
            <table className="w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {message.tableData.headers.map((header, index) => (
                    <th
                      key={index}
                      className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {message.tableData.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-gray-50">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-2 py-2 text-xs text-gray-900 whitespace-nowrap"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {message.tableData.summary && (
            <div className="mt-2 text-xs text-gray-600 bg-gray-50 p-2 rounded-lg">
              <p className="whitespace-pre-wrap">{message.tableData.summary}</p>
            </div>
          )}
          
          {/* Render any additional content */}
          {message.content && !message.content.includes('```') && (
            <>
              {message.content.includes('<div') || message.content.includes('<html') ? (
                <div 
                  className="mt-2 text-sm" 
                  dangerouslySetInnerHTML={{ __html: message.content }}
                />
              ) : (
                <p className="whitespace-pre-wrap mt-2 text-sm">{message.content}</p>
              )}
            </>
          )}
        </div>
      );
    }
    
    // Check if content contains HTML and render accordingly
    const isHtmlContent = message.content.includes('<div') || message.content.includes('<html') || message.content.includes('<a href');
    
    if (isHtmlContent) {
      return (
        <div 
          className="whitespace-pre-wrap text-sm" 
          dangerouslySetInnerHTML={{ __html: message.content }}
        />
      );
    }
    
    return <p className="whitespace-pre-wrap text-sm">{message.content}</p>;
  };

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
                  if (parsed.content || parsed.tableData) {
                    setMessages(prev => 
                      prev.map(msg => 
                        msg.id === assistantMessage.id 
                          ? { 
                              ...msg, 
                              content: parsed.content ? msg.content + parsed.content : msg.content,
                              needsCalendarAuth: parsed.needsCalendarAuth || msg.needsCalendarAuth,
                              tableData: parsed.tableData || msg.tableData
                            }
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
      // Refocus the input after sending a message
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100);
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
              {/* New Chat Button */}
              <button
                onClick={handleClearChat}
                className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center transition-colors group"
                title="Start New Chat"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
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
                className={`inline-block max-w-sm lg:max-w-lg px-3 py-2 rounded-lg text-sm ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-800 border'
                }`}
              >
                <p className="text-sm font-medium mb-1">
                  {message.role === 'user' ? (user?.name || user?.email || 'You') : 'AI Assistant'}
                </p>
                {renderMessageContent(message)}
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
          {/* Invisible element to scroll to */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
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
