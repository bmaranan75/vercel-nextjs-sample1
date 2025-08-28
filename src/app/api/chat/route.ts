import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getProducts, addToCart, getCartWithProducts, clearCart } from '../../../lib/shopping-store';
import { createCibaRequest } from '../../../lib/ciba-storage';

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
                        const session = await getSession();
                        
                        if (!session?.user?.sub) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ You need to be signed in to checkout.' })}\n\n`));
                          continue;
                        }

                        const userId = session.user.sub;

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n🛒 **Initiating Secure Checkout with Auth0 CIBA...**\n\n📱 Sending push notification to your authenticated device...' })}\n\n`));

                        // Get cart with products
                        const cartData = await getCartWithProducts(userId);
                        console.log('=== ASYNC_CHECKOUT INITIATED ===');
                        console.log('User ID:', userId);
                        console.log('Cart Data:', JSON.stringify(cartData, null, 2));
                        
                        if (!cartData.items || cartData.items.length === 0) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Your cart is empty. Please add some items before checkout.' })}\n\n`));
                          continue;
                        }

                        // Initiate Auth0 CIBA request
                        console.log('=== CALLING CIBA CHECKOUT API ===');
                        console.log('Request URL:', `${req.url.split('/api/chat')[0]}/api/ciba-checkout`);
                        console.log('Request Headers:', {
                          'Content-Type': 'application/json',
                          'Cookie': req.headers.get('cookie') ? '[PRESENT]' : '[MISSING]'
                        });
                        
                        const cibaResponse = await fetch(`${req.url.split('/api/chat')[0]}/api/ciba-checkout`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Cookie': req.headers.get('cookie') || ''
                          }
                        });

                        console.log('=== CIBA CHECKOUT API RESPONSE ===');
                        console.log('Response Status:', cibaResponse.status);
                        console.log('Response OK:', cibaResponse.ok);

                        let cibaData;
                        try {
                          cibaData = await cibaResponse.json();
                          console.log('Response Data:', JSON.stringify(cibaData, null, 2));
                        } catch (parseError) {
                          console.error('Failed to parse response as JSON:', parseError);
                          const responseText = await cibaResponse.text();
                          console.error('Raw response:', responseText);
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Failed to parse CIBA response. Check server logs.' })}\n\n`));
                          continue;
                        }

                        if (!cibaResponse.ok) {
                          console.error('=== CIBA INITIATION FAILED ===');
                          console.error('Failed Response Data:', JSON.stringify(cibaData, null, 2));
                          
                          // Handle specific CIBA configuration issues
                          if (cibaData.message && cibaData.message.includes('Push notifications are not configured')) {
                            const configErrorMessage = `

❌ **Push Notifications Not Configured**

Real Auth0 CIBA push notifications require additional setup:

🔧 **Required Setup:**
• Enable CIBA grant type in Auth0 Application settings
• Configure Auth0 Guardian for push notifications  
• User must have Auth0 Guardian mobile app installed
• Device must be enrolled for push notifications

📱 **Alternative for Testing:**
• Use web-based authorization (popup window)
• Or setup SMS-based authentication

⚠️ **Current Status:** CIBA endpoints not properly configured for this tenant.

💡 **Try saying "popup checkout" to use the web authorization method instead!**`;

                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: configErrorMessage })}\n\n`));
                            continue;
                          } else if (cibaData.message && cibaData.message.includes('No registered devices')) {
                            const deviceErrorMessage = `

📱 **No Registered Devices Found**

Push notifications require a registered mobile device:

📲 **Setup Required:**
1. Install Auth0 Guardian mobile app
2. Scan QR code to enroll device  
3. Enable push notifications in the app

💡 **Try saying "popup checkout" to use the web authorization method instead!**`;

                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: deviceErrorMessage })}\n\n`));
                            continue;
                          }
                          
                          // Generic error
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n❌ Failed to initiate checkout: ${cibaData.message}\n\n💡 **Try saying "popup checkout"** to use the web authorization method instead!` })}\n\n`));
                          continue;
                        }
                        
                        console.log('=== CIBA INITIATION SUCCESS ===');
                        console.log('CIBA Response Data:', JSON.stringify(cibaData, null, 2));
                        console.log('Auth Request ID:', cibaData.cibaResponse?.auth_req_id);
                        console.log('Expires In:', cibaData.cibaResponse?.expires_in, 'seconds');
                        console.log('Polling Interval:', cibaData.cibaResponse?.interval, 'seconds');

                        // Show CIBA status message
                        const cibaMessage = `

🔐 **Push Notification Sent!**

📱 Check your authenticated device for the authorization request:
• **Checkout**: ${cibaData.cartData?.itemCount || 0} item(s)
• **Total**: $${cibaData.cartData?.total?.toFixed(2) || '0.00'}
• **Message**: "${cibaData.bindingMessage || 'Checkout authorization request'}"

⏳ **Waiting for your approval...**

The authorization request will expire in ${Math.round((cibaData.cibaResponse?.expires_in || 300) / 60)} minutes.

---

💡 **Alternative Option**: If you don't receive the push notification or prefer web-based authorization, you can say **"popup checkout"** to use the traditional browser popup flow instead.`;

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                          content: cibaMessage,
                          cibaAuthReqId: cibaData.cibaResponse?.auth_req_id,
                          cibaCheckout: true 
                        })}\n\n`));

                        // Set async operation flag
                        hasAsyncOperation = true;

                        // Poll for CIBA completion
                        const pollForCibaCompletion = async () => {
                          const maxAttempts = Math.ceil((cibaData.cibaResponse?.expires_in || 300) / (cibaData.cibaResponse?.interval || 5)); // Use Auth0's recommended interval
                          let attempts = 0;
                          let slowDownDelay = cibaData.cibaResponse?.interval || 5;
                          let consecutiveAuthErrors = 0;
                          const maxAuthErrors = 3; // Stop after 3 consecutive 401/403 errors
                          
                          while (attempts < maxAttempts) {
                            try {
                              await new Promise(resolve => setTimeout(resolve, slowDownDelay * 1000));
                              attempts++;
                              
                              console.log(`=== CIBA POLLING ATTEMPT ${attempts}/${maxAttempts} ===`);
                              console.log('Auth Request ID:', cibaData.cibaResponse?.auth_req_id);
                              console.log('Poll URL:', `${req.url.split('/api/chat')[0]}/api/ciba-checkout?auth_req_id=${cibaData.cibaResponse?.auth_req_id}`);
                              
                              // Poll the CIBA status
                              const statusResponse = await fetch(`${req.url.split('/api/chat')[0]}/api/ciba-checkout?auth_req_id=${cibaData.cibaResponse?.auth_req_id}`, {
                                method: 'GET',
                                headers: {
                                  'Cookie': req.headers.get('cookie') || ''
                                }
                              });

                              const statusResult = await statusResponse.json();
                              console.log(`=== CIBA POLL RESULT ${attempts} ===`);
                              console.log('Response Status:', statusResponse.status);
                              console.log('Response OK:', statusResponse.ok);
                              console.log('Status Result:', JSON.stringify(statusResult, null, 2));

                              // Check for persistent authorization errors (401/403 or unauthorized_client)
                              if (statusResponse.status === 401 || statusResponse.status === 403 || 
                                  (statusResult.status === 'pending' && statusResult.message && 
                                   statusResult.message.includes('Authorization configuration issue detected'))) {
                                consecutiveAuthErrors++;
                                console.log(`=== AUTHORIZATION ERROR DETECTED ===`);
                                console.log(`Status: ${statusResponse.status}, Message: ${statusResult.message}`);
                                console.log(`Consecutive errors: ${consecutiveAuthErrors}/${maxAuthErrors}`);
                                
                                if (consecutiveAuthErrors >= maxAuthErrors) {
                                  console.log('=== STOPPING POLLING DUE TO PERSISTENT AUTH ERRORS ===');
                                  const authErrorMessage = `

❌ **Authorization Configuration Issue**

The checkout authorization is failing due to configuration issues:
• **Error**: Authorization not allowed for the client
• **Details**: CIBA grant type appears to not be enabled for the M2M client

🔧 **This appears to be a persistent configuration issue.**

💡 **Try saying "popup checkout"** to use the web authorization method instead!

Your cart remains unchanged and you can retry with the alternative method.`;

                                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: authErrorMessage })}\n\n`));
                                  controller.close(); // Close controller to re-enable chatbox
                                  return; // Exit polling early
                                }
                                
                                // Continue polling for now, but we're tracking the errors
                                console.log(`Authorization error ${consecutiveAuthErrors}/${maxAuthErrors}, continuing to poll...`);
                                continue;
                              } else {
                                // Reset error counter on successful response
                                consecutiveAuthErrors = 0;
                              }

                              if (statusResult.status === 'approved') {
                                // Success! Authorization approved - now complete the checkout
                                console.log('=== CIBA AUTHORIZATION APPROVED ===');
                                console.log('Checkout details:', JSON.stringify(statusResult.checkout, null, 2));
                                
                                const session = await getSession();
                                const userId = session?.user?.sub;
                                
                                if (userId) {
                                  // TEMPORARILY COMMENTED OUT - Clear the cart only after successful authorization
                                  console.log('TESTING: Cart clearing disabled - cart will remain for testing');
                                  // clearCart(userId);
                                  // console.log('Cart cleared successfully');
                                } else {
                                  console.error('Unable to clear cart - no user session');
                                }
                                
                                const successMessage = `

✅ **Checkout Approved & Completed!**

🎉 Your order has been successfully processed:
• **Items**: ${statusResult.checkout.itemCount} 
• **Total**: $${statusResult.checkout.total.toFixed(2)}
• **Completed**: ${new Date(statusResult.checkout.timestamp).toLocaleString()}

🧪 **TESTING MODE**: Cart has been preserved for testing purposes!`;

                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: successMessage })}\n\n`));
                                controller.close(); // Close controller to re-enable chatbox
                                return; // Exit polling
                              } else if (statusResult.status === 'denied') {
                                // User denied the request
                                const deniedMessage = `

❌ **Checkout Denied**

The authorization request was denied. Your cart remains unchanged.
You can try again by saying "checkout" if you'd like to proceed.`;

                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: deniedMessage })}\n\n`));
                                controller.close(); // Close controller to re-enable chatbox
                                return; // Exit polling
                              } else if (statusResult.status === 'expired') {
                                // Request expired
                                const expiredMessage = `

⏰ **Authorization Expired**

The checkout authorization request has expired. Your cart remains unchanged.
Please say "checkout" again to restart the process.`;

                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: expiredMessage })}\n\n`));
                                controller.close(); // Close controller to re-enable chatbox
                                return; // Exit polling
                              } else if (statusResult.status === 'slow_down') {
                                // Auth0 requests slower polling
                                slowDownDelay = Math.min(slowDownDelay * 1.5, 30); // Cap at 30 seconds
                                console.log(`CIBA slow down requested, increasing interval to ${slowDownDelay}s`);
                                continue;
                              } else if (statusResult.status === 'pending') {
                                // Still waiting, continue polling
                                console.log(`Authorization still pending, continuing to poll (attempt ${attempts}/${maxAttempts})`);
                                continue;
                              } else {
                                // Some other error
                                console.error('=== CIBA POLLING ERROR ===');
                                console.error('Status Result:', JSON.stringify(statusResult, null, 2));
                                const errorMessage = `

❌ **Authorization Error**

${statusResult.message || 'An error occurred during authorization.'}
Please try again.`;

                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: errorMessage })}\n\n`));
                                controller.close(); // Close controller to re-enable chatbox
                                return; // Exit polling
                              }
                              
                            } catch (pollError) {
                              console.error('=== CIBA POLLING REQUEST FAILED ===');
                              console.error('Poll Error Details:', {
                                message: pollError instanceof Error ? pollError.message : 'Unknown error',
                                stack: pollError instanceof Error ? pollError.stack : undefined,
                                attempt: attempts,
                                maxAttempts: maxAttempts,
                                authReqId: cibaData.auth_req_id
                              });
                              if (attempts >= maxAttempts) {
                                const timeoutMessage = `

⏰ **Checkout Timeout**

The authorization request timed out. Your cart remains unchanged.
Please try again by saying "checkout".`;

                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: timeoutMessage })}\n\n`));
                                controller.close(); // Close controller to re-enable chatbox
                                return;
                              }
                              // Continue polling on error
                            }
                          }
                          
                          // Max attempts reached
                          const timeoutMessage = `

⏰ **Checkout Timeout**

The authorization request timed out after ${Math.round((maxAttempts * slowDownDelay) / 60)} minutes.
Your cart remains unchanged. Please try again by saying "checkout".`;

                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: timeoutMessage })}\n\n`));
                        };

                        // Start background polling (don't await)
                        pollForCibaCompletion().catch(error => {
                          console.error('CIBA polling error:', error);
                          const errorMessage = `

❌ **Checkout Error**

An error occurred during the authorization process. Please try again.`;
                          
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: errorMessage })}\n\n`));
                        });

                      } catch (error) {
                        console.error('Auth0 CIBA checkout error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble initiating the secure checkout. Please try again.' })}\n\n`));
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
