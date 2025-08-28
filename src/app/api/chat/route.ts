import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getProducts, addToCart, getCartWithProducts, clearCart } from '../../../lib/shopping-store';
import { createCibaRequest } from '../../../lib/ciba-storage';
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
          description: 'Display all available products in the store',
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
          description: 'Add a product to the shopping cart using product ID or product name',
          parameters: {
            type: 'object',
            properties: {
              productId: {
                type: 'string',
                description: 'The ID (e.g. "1", "2") or name (e.g. "Milk", "Bread") of the product to add'
              },
              quantity: {
                type: 'number',
                description: 'The quantity to add (default: 1)'
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
          description: 'Initiate secure checkout with Auth0 popup web page authorization (traditional flow)',
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
          description: 'Get Google Calendar events for the user. Requires user authorization.',
          parameters: {
            type: 'object',
            properties: {
              timeMin: {
                type: 'string',
                description: 'Start time for events (ISO string). Defaults to now.'
              },
              timeMax: {
                type: 'string',
                description: 'End time for events (ISO string). Defaults to 7 days from now.'
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
          description: 'Display all available commands and tools in a formatted view',
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
                    
                    if (accumulated.function.name === 'get_weather') {
                      try {
                        if (!process.env.OPENWEATHER_API_KEY) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Weather API key not configured.' })}\n\n`));
                          continue;
                        }

                        const weatherResponse = await fetch(
                          `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(args.city)}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`
                        );

                        if (!weatherResponse.ok) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n❌ Could not find weather data for "${args.city}". API Error: ${weatherResponse.status} - ${weatherResponse.statusText}` })}\n\n`));
                          continue;
                        }

                        const weatherData = await weatherResponse.json();
                        const temp = Math.round(weatherData.main.temp);
                        const feelsLike = Math.round(weatherData.main.feels_like);
                        const humidity = weatherData.main.humidity;
                        const description = weatherData.weather[0].description;
                        const cityName = weatherData.name;
                        const country = weatherData.sys.country;

                        const formattedResponse = `\n\n🌤️ **Weather in ${cityName}, ${country}**

🌡️ **${temp}°C** (feels like ${feelsLike}°C)
💨 **${description}**
💧 **Humidity:** ${humidity}%

*Current conditions*`;
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: formattedResponse })}\n\n`));
                      } catch (error) {
                        console.error('Weather API error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble getting the weather data.' })}\n\n`));
                      }
                    } else if (accumulated.function.name === 'get_calendar') {
                      try {
                        const session = await getSession();
                        if (!session?.user?.sub) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ You need to be signed in to view your calendar.' })}\n\n`));
                          continue;
                        }

                        const timeMin = args.timeMin || new Date().toISOString();
                        const timeMax = args.timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

                        const calendarResponse = await fetch(`${req.url.split('/api/chat')[0]}/api/calendar?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`, {
                          headers: {
                            'Cookie': req.headers.get('cookie') || ''
                          }
                        });

                        const calendarData = await calendarResponse.json();

                        if (!calendarResponse.ok) {
                          if (calendarData.needsAuth) {
                            const authMessage = `

� **Google Calendar Authorization Required**

To view your calendar events, I need permission to access your Google Calendar.

{{CALENDAR_AUTH_BUTTON}}

After authorization, please ask me about your calendar again.`;
                            
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: authMessage, needsCalendarAuth: true })}\n\n`));
                          } else {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n❌ ${calendarData.error}` })}\n\n`));
                          }
                          continue;
                        }

                        const events = calendarData.events;
                        let formattedResponse = `

� **Your Upcoming Calendar Events:**

`;
                        
                        if (events.length === 0) {
                          formattedResponse += 'No events found in the specified time range.';
                        } else {
                          events.forEach((event: any, index: number) => {
                            const startTime = new Date(event.start).toLocaleString();
                            const endTime = new Date(event.end).toLocaleString();
                            
                            formattedResponse += `**${index + 1}. ${event.summary}**
- **Time:** ${startTime} - ${endTime}
${event.description ? `- **Description:** ${event.description}\n` : ''}${event.location ? `- **Location:** ${event.location}\n` : ''}${event.attendees.length > 0 ? `- **Attendees:** ${event.attendees.join(', ')}\n` : ''}

`;
                          });
                        }
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: formattedResponse })}\n\n`));
                      } catch (error) {
                        console.error('Calendar tool error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble accessing your calendar.' })}\n\n`));
                      }
                    } else if (accumulated.function.name === 'list_products') {
                      try {
                        const products = getProducts();
                        
                        let productRows = '';
                        products.forEach((product, index) => {
                          const rowStyle = index % 2 === 0 ? 'background-color: #fff;' : 'background-color: #f8f9fa;';
                          productRows += `
        <tr style="${rowStyle}">
          <td style="padding: 6px; border-bottom: 1px solid #dee2e6; font-weight: 500; color: #333;">${product.id}</td>
          <td style="padding: 6px; border-bottom: 1px solid #dee2e6; font-weight: 500; color: #333;">${product.name}</td>
          <td style="padding: 6px; border-bottom: 1px solid #dee2e6; color: #666;">${product.description}</td>
          <td style="padding: 6px; text-align: right; border-bottom: 1px solid #dee2e6; font-weight: 500; color: #333;">$${product.price.toFixed(2)}</td>
        </tr>`;
                        });

                        const response = `<div style="padding: 10px; border: 1px solid #007bff; border-radius: 6px; background-color: #f8f9fa; font-family: Arial, sans-serif; font-size: 13px;">
  <div style="color: #007bff; font-weight: bold; margin-bottom: 6px; font-size: 16px;">
    🛍️ BRM Sari-Sari Store - Product Catalog
  </div>
  <div style="background-color: white; border-radius: 4px; overflow: hidden; margin: 6px 0;">
    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
      <thead style="background-color: #f8f9fa;">
        <tr>
          <th style="padding: 8px 6px; text-align: left; border-bottom: 1px solid #dee2e6; font-weight: 600; color: #333;">ID</th>
          <th style="padding: 8px 6px; text-align: left; border-bottom: 1px solid #dee2e6; font-weight: 600; color: #333;">Product</th>
          <th style="padding: 8px 6px; text-align: left; border-bottom: 1px solid #dee2e6; font-weight: 600; color: #333;">Description</th>
          <th style="padding: 8px 6px; text-align: right; border-bottom: 1px solid #dee2e6; font-weight: 600; color: #333;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${productRows}
      </tbody>
    </table>
  </div>
  <div style="font-size: 11px; color: #007bff; margin-top: 4px; text-align: center;">
    💡 Use "add [product name] to cart" or "add product ID [number]" to add items.
  </div>
</div>`;
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: response })}\n\n`));
                      } catch (error) {
                        console.error('Product listing error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble loading the products.' })}\n\n`));
                      }
                    } else if (accumulated.function.name === 'add_to_cart') {
                      try {
                        const session = await getSession();
                        
                        if (!session?.user?.sub) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ You need to be signed in to add items to cart.' })}\n\n`));
                          continue;
                        }
                        
                        const productId = args.productId;
                        const quantity = args.quantity || 1;
                        const userId = session.user.sub;
                        
                        const success = await addToCart(userId, productId, quantity);
                        
                        if (success) {
                          const products = getProducts();
                          const product = products.find(p => p.id.toString() === productId.toString() || p.name.toLowerCase() === productId.toString().toLowerCase());
                          
                          const formattedResponse = `\n\n✅ Added ${quantity} x ${product?.name} to your cart.`;
                          
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: formattedResponse })}\n\n`));
                        } else {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Product not found. Please use "show products" to see available items.' })}\n\n`));
                        }
                      } catch (error) {
                        console.error('Add to cart error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble adding the item to your cart.' })}\n\n`));
                      }
                    } else if (accumulated.function.name === 'view_cart') {
                      try {
                        const session = await getSession();
                        
                        if (!session?.user?.sub) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ You need to be signed in to view your cart.' })}\n\n`));
                          continue;
                        }
                        
                        const userId = session.user.sub;
                        const cartData = await getCartWithProducts(userId);

                        if (cartData.items.length === 0) {
                          const emptyCartResponse = `<div style="padding: 10px; border: 1px solid #6c757d; border-radius: 6px; background-color: #f8f9fa; font-family: Arial, sans-serif; font-size: 13px; text-align: center;">
  <div style="color: #6c757d; font-weight: bold; margin-bottom: 6px; font-size: 16px;">
    🛒 Your Cart is Empty
  </div>
  <div style="background-color: white; padding: 8px; border-radius: 4px; margin: 6px 0; font-size: 12px; color: #666;">
    No items in your cart yet. Browse our products and add some items!
  </div>
  <div style="font-size: 11px; color: #007bff; margin-top: 4px;">
    💡 Use "show products" to see what's available.
  </div>
</div>`;
                          
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: emptyCartResponse })}\n\n`));
                          continue;
                        }

                        let cartRows = '';
                        cartData.items.forEach((item, index) => {
                          if (item.product) {
                            const subtotal = item.product.price * item.quantity;
                            const rowStyle = index % 2 === 0 ? 'background-color: #fff;' : 'background-color: #f8f9fa;';
                            cartRows += `
        <tr style="${rowStyle}">
          <td style="padding: 6px; border-bottom: 1px solid #dee2e6; font-weight: 500; color: #333;">${item.product.name}</td>
          <td style="padding: 6px; text-align: center; border-bottom: 1px solid #dee2e6; color: #666;">${item.quantity}</td>
          <td style="padding: 6px; text-align: right; border-bottom: 1px solid #dee2e6; color: #666;">$${item.product.price.toFixed(2)}</td>
          <td style="padding: 6px; text-align: right; border-bottom: 1px solid #dee2e6; font-weight: 500; color: #333;">$${subtotal.toFixed(2)}</td>
        </tr>`;
                          }
                        });

                        const response = `<div style="padding: 10px; border: 1px solid #007bff; border-radius: 6px; background-color: #f8f9fa; font-family: Arial, sans-serif; font-size: 13px;">
  <div style="color: #007bff; font-weight: bold; margin-bottom: 6px; font-size: 16px;">
    🛒 Your Shopping Cart
  </div>
  <div style="background-color: white; border-radius: 4px; overflow: hidden; margin: 6px 0;">
    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
      <thead style="background-color: #f8f9fa;">
        <tr>
          <th style="padding: 8px 6px; text-align: left; border-bottom: 1px solid #dee2e6; font-weight: 600; color: #333;">Item</th>
          <th style="padding: 8px 6px; text-align: center; border-bottom: 1px solid #dee2e6; font-weight: 600; color: #333;">Qty</th>
          <th style="padding: 8px 6px; text-align: right; border-bottom: 1px solid #dee2e6; font-weight: 600; color: #333;">Price</th>
          <th style="padding: 8px 6px; text-align: right; border-bottom: 1px solid #dee2e6; font-weight: 600; color: #333;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${cartRows}
      </tbody>
    </table>
  </div>
  <div style="text-align: right; margin: 8px 0 6px 0; padding: 6px 8px; background-color: #e7f3ff; border-radius: 4px; border-left: 3px solid #007bff;">
    <span style="font-weight: bold; font-size: 14px; color: #007bff;">Total: $${cartData.total.toFixed(2)}</span>
  </div>
  <div style="text-align: center; font-size: 11px; color: #28a745; margin-top: 4px;">
    💰 Ready to checkout!
  </div>
</div>`;
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: response })}\n\n`));
                      } catch (error) {
                        console.error('View cart error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble accessing your cart.' })}\n\n`));
                      }
                    } else if (accumulated.function.name === 'async_checkout') {
                      try {
                        console.log('🔍 Intercepting async_checkout - calling Auth0 AI wrapped version...');
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n🛒 **Initiating Secure Checkout with Auth0 AI...**\n\n📱 Sending push notification to your authenticated device...' })}\n\n`));
                        
                        // Use the already-wrapped asyncCheckout tool directly
                        const checkoutResult = await asyncCheckout.execute(
                          { confirmCheckout: true }, 
                          { 
                            toolCallId: accumulated.id,
                            messages: messages || []
                          }
                        );
                        
                        console.log('✅ Auth0 AI checkout completed without interrupt:', checkoutResult);
                        
                        // If we reach here, no CIBA interrupt was thrown
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n✅ **Checkout Completed Successfully!**\n\n${checkoutResult}` })}\n\n`));
                        
                      } catch (error: any) {
                        console.log('🚨 Auth0 AI interrupt caught in tool execution:', error.constructor?.name || error.name);
                        console.log('Error details:', error);
                        
                        if (error.name?.includes('Interrupt') || error.constructor?.name?.includes('Interrupt')) {
                          console.log('✅ Auth0 CIBA interrupt triggered successfully!');
                          console.log('Error details for context:', error);
                          
                          // Mark that we have an async operation running
                          hasAsyncOperation = true;
                          
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: '\n\n🔐 **CIBA Authorization Required**\n\n📱 A push notification has been sent to your authenticated device. Please approve the checkout request on your device to continue.\n\n⏳ Waiting for your approval...' 
                          })}\n\n`));
                          
                          // Extract the Auth0 AI context from the error
                          const authContext = error.request || {};
                          const authReqId = authContext.id || authContext.auth_req_id;
                          
                          console.log('Auth0 AI CIBA context:', authContext);
                          console.log('Auth Request ID:', authReqId);
                          
                          if (!authReqId) {
                            console.error('❌ No auth_req_id found in CIBA context');
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                              content: '\n\n❌ **Authorization Error**\n\nCould not track authorization status. Please try again.' 
                            })}\n\n`));
                            controller.close();
                            return;
                          }
                          
                          // Implement CIBA polling using Auth0 token endpoint
                          const pollForCompletion = async () => {
                            const maxAttempts = 60; // 5 minutes total (60 attempts * 5 seconds)
                            let attempts = 0;
                            let slowDownDelay = 5; // Start with 5 seconds
                            
                            while (attempts < maxAttempts) {
                              await new Promise(resolve => setTimeout(resolve, slowDownDelay * 1000));
                              attempts++;
                              
                              console.log(`=== CIBA STATUS POLLING ATTEMPT ${attempts}/${maxAttempts} ===`);
                              console.log('Checking auth_req_id:', authReqId);
                              
                              try {
                                // Use the CIBA token endpoint to check status
                                const tokenResponse = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                  },
                                  body: new URLSearchParams({
                                    grant_type: 'urn:ietf:params:oauth:grant-type:ciba',
                                    auth_req_id: authReqId,
                                    client_id: process.env.AUTH0_CLIENT_ID!,
                                    client_secret: process.env.AUTH0_CLIENT_SECRET!,
                                  }),
                                });
                                
                                const tokenData = await tokenResponse.json();
                                console.log('CIBA token response:', tokenResponse.status, tokenData);
                                
                                if (tokenResponse.ok && tokenData.access_token) {
                                  // Authorization approved! Now execute the checkout
                                  console.log('✅ CIBA authorization approved, executing checkout...');
                                  
                                  try {
                                    // Now execute the checkout directly without Auth0 AI wrapper
                                    // Import the base tool without the wrapper
                                    const { tool } = await import('ai');
                                    const { getSession } = await import('@auth0/nextjs-auth0');
                                    const { getCartWithProducts, clearCart } = await import('../../../lib/shopping-store');
                                    
                                    console.log('🔍 Getting session for direct checkout...');
                                    const session = await getSession();
                                    const userId = session?.user?.sub;
                                    
                                    if (!userId) {
                                      throw new Error('User not authenticated');
                                    }
                                    
                                    const cartData = await getCartWithProducts(userId);
                                    if (!cartData.items || cartData.items.length === 0) {
                                      throw new Error('Cart is empty');
                                    }
                                    
                                    // Process the checkout
                                    const checkout = {
                                      itemCount: cartData.items.length,
                                      total: cartData.total,
                                      timestamp: new Date().toISOString(),
                                      items: cartData.items
                                    };
                                    
                                    console.log('✅ Checkout processed successfully:', checkout);
                                    
                                    const successMessage = `Checkout completed successfully! Processed ${checkout.itemCount} items for a total of $${checkout.total.toFixed(2)} at ${new Date(checkout.timestamp).toLocaleString()}. Cart preserved for testing.`;
                                    
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                                      content: `\n\n✅ **Authorization Approved!**\n\n🎉 **Checkout Completed Successfully!**\n\n${successMessage}` 
                                    })}\n\n`));
                                    
                                  } catch (checkoutError: any) {
                                    console.error('Checkout execution error:', checkoutError);
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                                      content: `\n\n❌ **Checkout Error**\n\nAuthorization was approved, but checkout failed: ${checkoutError.message || 'Unknown error'}` 
                                    })}\n\n`));
                                  }
                                  
                                  // Close the stream
                                  controller.close();
                                  return;
                                  
                                } else if (tokenData.error === 'authorization_pending') {
                                  // Still pending, continue polling
                                  console.log(`Authorization still pending (attempt ${attempts}/${maxAttempts})`);
                                  continue;
                                  
                                } else if (tokenData.error === 'slow_down') {
                                  // Auth0 requests slower polling
                                  slowDownDelay = Math.min(slowDownDelay * 1.5, 30); // Cap at 30 seconds
                                  console.log(`CIBA slow down requested, increasing interval to ${slowDownDelay}s`);
                                  continue;
                                  
                                } else if (tokenData.error === 'access_denied') {
                                  // User denied the request
                                  console.log('❌ User denied CIBA authorization');
                                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                                    content: '\n\n❌ **Authorization Denied**\n\nYou denied the checkout request. Your cart remains unchanged.' 
                                  })}\n\n`));
                                  controller.close();
                                  return;
                                  
                                } else if (tokenData.error === 'expired_token') {
                                  // Request expired
                                  console.log('⏰ CIBA authorization expired');
                                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                                    content: '\n\n⏰ **Authorization Expired**\n\nThe authorization request has expired. Please try again.' 
                                  })}\n\n`));
                                  controller.close();
                                  return;
                                  
                                } else {
                                  // Unknown error
                                  console.error('Unknown CIBA token error:', tokenData);
                                  continue;
                                }
                                
                              } catch (tokenError) {
                                console.error('CIBA token check error:', tokenError);
                                continue;
                              }
                            }
                            
                            // Timeout reached
                            console.log('⏰ CIBA authorization timeout');
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                              content: '\n\n⏰ **Authorization Timeout**\n\nThe authorization request timed out. Please try again.' 
                            })}\n\n`));
                            controller.close();
                          };
                          
                          // Start polling in the background
                          pollForCompletion().catch(error => {
                            console.error('CIBA polling error:', error);
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                              content: '\n\n❌ **Authorization Error**\n\nAn error occurred during authorization. Please try again.' 
                            })}\n\n`));
                            controller.close();
                          });
                          
                        } else {
                          console.error('Non-Auth0 error in checkout:', error);
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: `\n\n❌ **Checkout Error**\n\nSorry, there was an issue with the checkout process: ${error.message || 'Unknown error'}` 
                          })}\n\n`));
                        }
                      }
                    } else if (accumulated.function.name === 'popup_checkout') {
                      try {
                        const session = await getSession();
                        
                        if (!session?.user?.sub) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ You need to be signed in to checkout.' })}\n\n`));
                          continue;
                        }

                        const userId = session.user.sub;

                        // Get cart with products
                        const cartData = await getCartWithProducts(userId);
                        console.log('=== POPUP_CHECKOUT INITIATED ===');
                        console.log('User ID:', userId);
                        console.log('Cart Data:', JSON.stringify(cartData, null, 2));
                        
                        if (!cartData.items || cartData.items.length === 0) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Your cart is empty. Please add some items before checkout.' })}\n\n`));
                          continue;
                        }

                        // Import popup storage
                        const { storePopupRequest, getPopupRequest } = await import('../../../lib/popup-storage');
                        
                        // Store popup request for tracking
                        const popupRequestId = storePopupRequest(userId, cartData);

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n🛒 **Initiating Secure Checkout with Web Authorization...**\n\n🌐 Opening authorization popup window...' })}\n\n`));

                        // For popup checkout, we need to use the Auth0 AI SDK
                        // This will trigger a popup window for authorization
                        const checkoutMessage = `

🔐 **Web Authorization Required**

📱 A popup window will open for secure authorization:
• **Checkout**: ${cartData.items.length} item(s)
• **Total**: $${cartData.total.toFixed(2)}

🌐 **Next Steps:**
1. Click "Authorize Checkout" below to open popup
2. Complete authorization in the popup window
3. Return here to see confirmation

<div style="text-align: center; margin: 15px 0;">
  <button onclick="window.openAuth0Popup('${popupRequestId}')" style="background-color: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 14px;">
    🔐 Authorize Checkout
  </button>
</div>

⚠️ **Note:** Make sure popup blockers are disabled for this site.

⏳ **Waiting for authorization...**`;

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                          content: checkoutMessage,
                          popupCheckout: true,
                          cartData: {
                            itemCount: cartData.items.length,
                            total: cartData.total,
                            items: cartData.items.map(item => ({
                              name: item.product?.name || 'Unknown Product',
                              price: item.product?.price || 0,
                              quantity: item.quantity
                            }))
                          }
                        })}\n\n`));

                        // Start polling for popup completion
                        hasAsyncOperation = true;
                        const maxPolls = 60; // 5 minutes total (60 polls * 5 seconds)
                        let pollCount = 0;
                        let consecutiveErrors = 0;
                        const maxAuthErrors = 3;

                        const pollPopupStatus = async () => {
                          try {
                            pollCount++;
                            console.log(`=== POPUP POLLING ATTEMPT ${pollCount}/${maxPolls} ===`);
                            console.log('Popup Request ID:', popupRequestId);

                            const request = getPopupRequest(popupRequestId);
                            
                            if (!request) {
                              console.log('Popup request not found or expired');
                              const errorMessage = `\n\n❌ **Authorization Expired**\n\nThe authorization request has expired. Please try again.`;
                              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: errorMessage })}\n\n`));
                              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                              controller.close();
                              return;
                            }

                            if (request.status === 'completed') {
                              console.log('Popup checkout completed successfully');
                              const successMessage = `\n\n✅ **Checkout Successful!**\n\n🎉 Your order has been processed:\n• **Items**: ${request.result.itemCount} item(s)\n• **Total**: $${request.result.total.toFixed(2)}\n\n📧 Confirmation details will be sent to your email.`;
                              
                              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: successMessage })}\n\n`));
                              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                              controller.close();
                              return;
                            }

                            if (request.status === 'failed') {
                              console.log('Popup checkout failed:', request.error);
                              const errorMessage = `\n\n❌ **Authorization Failed**\n\n${request.error || 'An error occurred during authorization.'}\n\nPlease try again.`;
                              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: errorMessage })}\n\n`));
                              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                              controller.close();
                              return;
                            }

                            // Still pending
                            if (pollCount >= maxPolls) {
                              console.log('=== POPUP POLLING TIMEOUT ===');
                              const timeoutMessage = `\n\n⏰ **Authorization Timeout**\n\nThe authorization process took too long. Please try again.`;
                              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: timeoutMessage })}\n\n`));
                              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                              controller.close();
                              return;
                            }

                            // Continue polling
                            setTimeout(pollPopupStatus, 5000);

                          } catch (error) {
                            console.error('Popup polling error:', error);
                            consecutiveErrors++;
                            
                            if (consecutiveErrors >= maxAuthErrors) {
                              console.log('=== STOPPING POPUP POLLING DUE TO PERSISTENT ERRORS ===');
                              const errorMessage = `\n\n❌ **Checkout Error**\n\nToo many errors occurred during authorization. Please try again.`;
                              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: errorMessage })}\n\n`));
                              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                              controller.close();
                              return;
                            }

                            console.log(`Authorization error ${consecutiveErrors}/${maxAuthErrors}, continuing to poll...`);
                            setTimeout(pollPopupStatus, 5000);
                          }
                        };

                        // Start polling after a short delay
                        setTimeout(pollPopupStatus, 5000);

                      } catch (error) {
                        console.error('Popup checkout error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble initiating the popup checkout. Please try again.' })}\n\n`));
                      }
                    } else if (accumulated.function.name === 'show_help') {
                      try {
                        const helpResponse = `<div style="padding: 12px; border: 1px solid #007bff; border-radius: 8px; background-color: #f8f9fa; font-family: Arial, sans-serif; font-size: 13px; max-width: 600px;">
  <div style="color: #007bff; font-weight: bold; margin-bottom: 12px; font-size: 18px; text-align: center;">
    🤖 Available Commands & Tools
  </div>
  
  <div style="background-color: white; border-radius: 6px; padding: 10px; margin: 8px 0; border-left: 4px solid #28a745;">
    <div style="color: #28a745; font-weight: 600; margin-bottom: 6px; font-size: 14px;">🛍️ Shopping Commands</div>
    <div style="margin: 4px 0; padding: 4px 0; border-bottom: 1px solid #eee;">
      <strong style="color: #333;">"show products"</strong> or <strong style="color: #333;">"list products"</strong><br>
      <span style="color: #666; font-size: 12px;">Display all available grocery items</span>
    </div>
    <div style="margin: 4px 0; padding: 4px 0; border-bottom: 1px solid #eee;">
      <strong style="color: #333;">"add [product] to cart"</strong><br>
      <span style="color: #666; font-size: 12px;">Add items using product name or ID</span>
    </div>
    <div style="margin: 4px 0; padding: 4px 0; border-bottom: 1px solid #eee;">
      <strong style="color: #333;">"show cart"</strong> or <strong style="color: #333;">"view cart"</strong><br>
      <span style="color: #666; font-size: 12px;">Display current cart contents</span>
    </div>
    <div style="margin: 4px 0; padding: 4px 0;">
      <strong style="color: #333;">"checkout"</strong><br>
      <span style="color: #666; font-size: 12px;">Initiate secure checkout with authorization</span>
    </div>
  </div>

  <div style="background-color: white; border-radius: 6px; padding: 10px; margin: 8px 0; border-left: 4px solid #ffc107;">
    <div style="color: #ff8f00; font-weight: 600; margin-bottom: 6px; font-size: 14px;">📅 Calendar Commands</div>
    <div style="margin: 4px 0; padding: 4px 0; border-bottom: 1px solid #eee;">
      <strong style="color: #333;">"show my calendar"</strong> or <strong style="color: #333;">"what's on my schedule?"</strong><br>
      <span style="color: #666; font-size: 12px;">View your upcoming events</span>
    </div>
    <div style="margin: 4px 0; padding: 4px 0;">
      <strong style="color: #333;">"am I free on [date]?"</strong><br>
      <span style="color: #666; font-size: 12px;">Check availability for specific dates</span>
    </div>
  </div>

  <div style="background-color: white; border-radius: 6px; padding: 10px; margin: 8px 0; border-left: 4px solid #17a2b8;">
    <div style="color: #17a2b8; font-weight: 600; margin-bottom: 6px; font-size: 14px;">🌤️ Weather Commands</div>
    <div style="margin: 4px 0; padding: 4px 0;">
      <strong style="color: #333;">"weather in [city]"</strong><br>
      <span style="color: #666; font-size: 12px;">Get current weather for any city</span>
    </div>
  </div>

  <div style="text-align: center; margin-top: 12px; padding: 8px; background-color: #e7f3ff; border-radius: 4px;">
    <span style="color: #007bff; font-size: 12px; font-style: italic;">💡 Just type naturally! I'll understand what you want to do.</span>
  </div>
</div>`;
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: helpResponse })}\n\n`));
                      } catch (error) {
                        console.error('Show help error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble displaying the help information.' })}\n\n`));
                      }
                    }
                  } catch (parseError) {
                    console.error('Error parsing tool arguments:', parseError);
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('Stream error:', error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, there was an error processing your request.' })}\n\n`));
                        } finally {
          // Only close the controller if we don't have an async operation running
          console.log('Finally block - hasAsyncOperation:', hasAsyncOperation);
          if (!hasAsyncOperation) {
            console.log('Closing controller in finally block');
            controller.close();
          } else {
            console.log('NOT closing controller due to async operation');
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
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'An error occurred while processing your request.' },
      { status: 500 }
    );
  }
};
