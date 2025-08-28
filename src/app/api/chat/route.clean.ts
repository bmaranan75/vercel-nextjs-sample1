import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getProducts, addToCart, getCartWithProducts, clearCart } from '../../../lib/shopping-store';
import { createCibaRequest } from '../../../lib/ciba-storage';
import { withAsyncUserConfirmation } from '../../../lib/auth0-ai';
import { asyncCheckout } from '../../../lib/tools/async-checkout';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const POST = async (req: NextRequest) => {
  console.log('Chat API working!');
  try {
    const { messages } = await req.json();

    const systemMessage = {
      role: 'system' as const,
      content: `You are a helpful AI assistant with access to weather, calendar, and online shopping functions.

SHOPPING COMMANDS:
- "show products" or "list products" → Use list_products to display all available grocery items
- "add [product] to cart" → Use add_to_cart with the exact product ID from the product list
- "show cart" or "view cart" → Use view_cart to display current cart contents
- "checkout" → Use async_checkout to initiate secure Auth0 CIBA checkout with push notification (default)
- "popup checkout" or "web checkout" → Use popup_checkout only when specifically requested

CALENDAR COMMANDS:
- "show my calendar" or "what's on my schedule?" → Use get_calendar to view your upcoming events
- "am I free on [date]?" → Use get_calendar with a specific date to check for availability

CALENDAR INSTRUCTIONS:
1. When checking for specific dates, provide both start and end times for that day
2. If the user asks for availability, clearly state whether there are events or not
3. The calendar function requires user authorization - if they need to authorize, provide them with the authorization link

SHOPPING INSTRUCTIONS:
1. When users ask to ADD items to cart, use add_to_cart with the product ID immediately
2. When users ask to SEE products or BROWSE, use list_products to show available items
3. For adding items to cart, use the EXACT product ID (like 1, 2, 3, etc.) from the products list
4. Always confirm successful cart additions with a friendly message
5. Display cart contents in a clear table format with product names, prices, and quantities
6. For checkout requests:
   - **DEFAULT**: Always use async_checkout for "checkout" requests (Auth0 CIBA with push notifications)
   - **ALTERNATIVE**: Only use popup_checkout when specifically requested ("popup checkout" or "web checkout")
7. When using async_checkout (default):
   - This sends a real push notification to the user's authenticated device
   - The system will poll for authorization completion and automatically complete the checkout
   - No popup windows required - everything is handled via secure push notifications
   - Always mention the popup alternative at the end of the CIBA response
8. When using popup_checkout (only when specifically requested):
   - Opens a traditional Auth0 authorization popup window
   - User completes authorization in the web browser
   - Suitable when push notifications are not available

OTHER FUNCTIONS:
- get_weather: Get current weather for any city

HELP COMMANDS:
- "help" or "what can you do?" → Use show_help to display all available commands in a nicely formatted view

Be helpful, friendly, and respond directly to what the user is asking for without unnecessary steps.`
    };

    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'get_weather',
          description: 'Get current weather information for a specific city',
          parameters: {
            type: 'object',
            properties: {
              city: {
                type: 'string',
                description: 'The city name to get weather for'
              }
            },
            required: ['city']
          }
        }
      },
      {
        type: 'function' as const,
        function: {
          name: 'list_products',
          description: 'List all available products in the grocery store',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function' as const,
        function: {
          name: 'add_to_cart',
          description: 'Add a product to the shopping cart',
          parameters: {
            type: 'object',
            properties: {
              productId: {
                type: 'string',
                description: 'The ID of the product to add'
              },
              quantity: {
                type: 'number',
                description: 'The quantity to add (default: 1)',
                default: 1
              }
            },
            required: ['productId']
          }
        }
      },
      {
        type: 'function' as const,
        function: {
          name: 'view_cart',
          description: 'View the current shopping cart contents',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function' as const,
        function: {
          name: 'async_checkout',
          description: 'Initiate secure checkout with Auth0 CIBA push notification authorization',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function' as const,
        function: {
          name: 'popup_checkout',
          description: 'Initiate checkout with web popup authorization (only when specifically requested)',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function' as const,
        function: {
          name: 'get_calendar',
          description: 'Get calendar events for the authenticated user',
          parameters: {
            type: 'object',
            properties: {
              timeMin: {
                type: 'string',
                description: 'Start time for calendar query (ISO format)'
              },
              timeMax: {
                type: 'string',
                description: 'End time for calendar query (ISO format)'
              }
            },
            required: []
          }
        }
      },
      {
        type: 'function' as const,
        function: {
          name: 'show_help',
          description: 'Show all available commands and capabilities',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      }
    ];

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [systemMessage, ...messages],
      tools: tools,
      tool_choice: 'auto',
      stream: true,
    });

    const encoder = new TextEncoder();
    
    return new Response(new ReadableStream({
      async start(controller) {
        const toolCalls = new Map();
        let hasAsyncOperation = false; // Track if we have an async operation running
        
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            
            if (delta?.content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta.content })}\n\n`));
            }

            if (delta?.tool_calls) {
              console.log('Tool calls detected:', delta.tool_calls);
              
              for (const toolCall of delta.tool_calls) {
                const index = toolCall.index ?? 0;
                
                // Initialize tool call if not exists
                if (!toolCalls.has(index)) {
                  toolCalls.set(index, {
                    id: '',
                    type: 'function',
                    function: { name: '', arguments: '' }
                  });
                }
                
                const accumulated = toolCalls.get(index);
                
                // Accumulate tool call data
                if (toolCall.id) {
                  accumulated.id = toolCall.id;
                }
                if (toolCall.type) {
                  accumulated.type = toolCall.type;
                }
                if (toolCall.function?.name) {
                  accumulated.function.name = toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  accumulated.function.arguments += toolCall.function.arguments;
                }
                
                console.log('Accumulated tool call:', accumulated);
                
                // Try to execute if we have both name and complete arguments
                if (accumulated.function.name && accumulated.function.arguments) {
                  try {
                    const args = JSON.parse(accumulated.function.arguments);
                    console.log('Executing tool:', accumulated.function.name, 'with args:', args);
                    
                    // Clear the tool call to prevent re-execution
                    toolCalls.delete(index);
                    
                    if (accumulated.function.name === 'async_checkout') {
                      try {
                        console.log('🔍 Intercepting async_checkout - calling Auth0 AI wrapped version...');
                        
                        // Use Auth0 AI wrapped checkout tool instead of manual implementation
                        const auth0WrappedCheckout = withAsyncUserConfirmation(asyncCheckout);
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\\n\\n🛒 **Initiating Secure Checkout with Auth0 AI...**\\n\\n📱 Sending push notification to your authenticated device...' })}\n\n`));
                        
                        const checkoutResult = await auth0WrappedCheckout.execute(
                          { confirmCheckout: true }, 
                          { 
                            toolCallId: accumulated.id,
                            messages: messages || []
                          }
                        );
                        
                        console.log('✅ Auth0 AI checkout completed without interrupt:', checkoutResult);
                        
                        // If we reach here, no CIBA interrupt was thrown
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\\n\\n✅ **Checkout Completed Successfully!**\\n\\n${checkoutResult}` })}\n\n`));
                        
                      } catch (error: any) {
                        console.log('🚨 Auth0 AI interrupt caught in tool execution:', error.constructor?.name || error.name);
                        console.log('Error details:', error);
                        
                        if (error.name?.includes('Interrupt') || error.constructor?.name?.includes('Interrupt')) {
                          console.log('✅ Auth0 CIBA interrupt triggered successfully!');
                          
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: '\\n\\n🔐 **CIBA Authorization Required**\\n\\n📱 A push notification has been sent to your authenticated device. Please approve the checkout request on your device to continue.\\n\\n⏳ Waiting for your approval...' 
                          })}\n\n`));
                          
                          // The Auth0 AI SDK will handle the interrupt and resume execution
                          // No additional action needed here - the SDK manages the CIBA flow
                          
                        } else {
                          console.error('Non-Auth0 error in checkout:', error);
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: `\\n\\n❌ **Checkout Error**\\n\\nSorry, there was an issue with the checkout process: ${error.message || 'Unknown error'}` 
                          })}\n\n`));
                        }
                      }
                    } else {
                      // Handle other tools normally
                      // ... rest of tool implementations
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\\n\\nTool execution in progress...' })}\n\n`));
                    }
                  } catch (parseError) {
                    console.error('Failed to parse tool arguments:', parseError);
                    continue;
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('Chat stream error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\\n\\n❌ Sorry, there was an error processing your request.' })}\n\n`));
        } finally {
          console.log('Finally block - hasAsyncOperation:', hasAsyncOperation);
          if (!hasAsyncOperation) {
            controller.close();
          }
        }
      }
    }), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ 
      error: 'Failed to process request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};
