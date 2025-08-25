import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getProducts, addToCart, getCartWithProducts } from '../../../lib/shopping-store';
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
- "checkout" → Use async_checkout to initiate secure checkout with user authorization

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
6. When checking out, use async_checkout which will send a push notification for user authorization

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
          description: 'Initiate secure checkout with asynchronous user authorization via push notification',
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
                        
                        const success = addToCart(userId, productId, quantity);
                        
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
                        const cartData = getCartWithProducts(userId);

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

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n🛒 **Initiating Secure Checkout...**\n\nStarting authorization process...' })}\n\n`));

                        // Get cart with products directly (instead of fetch call)
                        const cartData = getCartWithProducts(userId);
                        console.log('Async checkout - Cart data:', cartData);
                        
                        if (!cartData.items || cartData.items.length === 0) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Your cart is empty. Please add some items before checkout.' })}\n\n`));
                          continue;
                        }

                        // Create CIBA authorization request directly
                        const bindingMessage = `Checkout for ${cartData.items.length} item(s), Total: $${cartData.total.toFixed(2)}`;
                        const authReqId = 'auth_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                        const authorizationUrl = `${req.url.split('/api/chat')[0]}/authorize?auth_req_id=${authReqId}&binding_message=${encodeURIComponent(bindingMessage)}`;

                        // Store the CIBA request for later approval/denial
                        console.log('Creating CIBA request:', { authReqId, userId, cartData });
                        createCibaRequest(authReqId, userId, cartData);
                        console.log('CIBA request created successfully');

                        // Create authResult object for compatibility
                        const authResult = {
                          success: true,
                          requiresAuthorization: true,
                          authReqId,
                          authorizationUrl,
                          message: 'Authorization required for checkout',
                          checkout: {
                            itemCount: cartData.items.length,
                            total: cartData.total,
                            bindingMessage
                          }
                        };

                        if (authResult.success && authResult.requiresAuthorization) {
                          const authMessage = `<div style="padding: 10px; border: 1px solid #007bff; border-radius: 6px; background-color: #f8f9fa; font-family: Arial, sans-serif; font-size: 13px;">
  <div style="color: #007bff; font-weight: bold; margin-bottom: 6px;">🔐 Authorization Required</div>
  
  <div style="background-color: white; padding: 6px 8px; border-radius: 4px; margin: 4px 0; font-size: 12px;">
    <strong>Checkout:</strong> ${authResult.checkout.itemCount} item(s) • Total: $${authResult.checkout.total.toFixed(2)}
  </div>
  
  <div style="text-align: center; margin: 6px 0;">
    <button onclick="(function(url) {
        const authWindow = window.open(
          url, 
          'authorization', 
          'width=600,height=700,scrollbars=yes,resizable=yes,status=yes,location=yes,toolbar=no,menubar=no'
        );
        if (authWindow) {
          authWindow.focus();
        } else {
          alert('Please allow popups for this site, or use the link below to open the authorization page.');
          window.open(url, '_blank');
        }
      })('${authResult.authorizationUrl}')"
       style="display: inline-block; 
              background-color: #28a745; 
              color: white; 
              padding: 6px 12px; 
              text-decoration: none; 
              border: none;
              border-radius: 4px; 
              font-weight: 500; 
              font-size: 12px;
              cursor: pointer;
              transition: background-color 0.2s;"
       onmouseover="this.style.backgroundColor='#218838'"
       onmouseout="this.style.backgroundColor='#28a745'">
      🔓 Authorize Checkout
    </button>
  </div>
  
  <div style="font-size: 11px; color: #6c757d; text-align: center, margin-top: 4px;">
    ⏳ Waiting for approval... | <a href="${authResult.authorizationUrl}" target="_blank" style="color: #007bff;">Open in new tab</a>
  </div>
</div>`;

                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: authMessage,
                            authReqId: authResult.authReqId,
                            authorizationUrl: authResult.authorizationUrl,
                            requiresAuth: true 
                          })}\n\n`));

                          // Implement proper CIBA polling instead of setTimeout
                          const pollForAuthorization = async () => {
                            const maxAttempts = 300; // 300 attempts = 5 minutes (1 second intervals)
                            let attempts = 0;
                            
                            while (attempts < maxAttempts) {
                              try {
                                // Wait 1 second between polls
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                attempts++;
                                
                                // Poll the authorization status
                                const tokenResponse = await fetch(`${req.url.split('/api/chat')[0]}/api/ciba-token`, {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'Cookie': req.headers.get('cookie') || ''
                                  },
                                  body: JSON.stringify({
                                    authReqId: authResult.authReqId
                                  })
                                });

                                const tokenResult = await tokenResponse.json();
                                console.log('CIBA poll result:', tokenResult, 'Response status:', tokenResponse.status);
                                
                                // Handle HTTP error responses (404, 403, etc.)
                                if (!tokenResponse.ok) {
                                  if (tokenResponse.status === 404) {
                                    // Request not found - might have been processed already
                                    console.log('CIBA request not found - might have been processed already');
                                    try {
                                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Authorization session expired. Please try checkout again.' })}\n\n`));
                                      controller.close();
                                    } catch (controllerError) {
                                      console.error('Controller already closed during 404:', controllerError);
                                    }
                                    return;
                                  } else if (tokenResponse.status === 403) {
                                    // Access denied
                                    try {
                                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Authorization was denied. Checkout cancelled.' })}\n\n`));
                                      controller.close();
                                    } catch (controllerError) {
                                      console.error('Controller already closed during 403:', controllerError);
                                    }
                                    return;
                                  } else if (tokenResponse.status === 408) {
                                    // Request timeout
                                    try {
                                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n⏰ Authorization request timed out. Please try again.' })}\n\n`));
                                      controller.close();
                                    } catch (controllerError) {
                                      console.error('Controller already closed during 408:', controllerError);
                                    }
                                    return;
                                  }
                                  // For other errors, continue polling for now
                                  continue;
                                }
                                
                                if (tokenResult.status === 'approved') {
                                  // Authorization approved - complete checkout
                                  const checkoutResponse = await fetch(`${req.url.split('/api/chat')[0]}/api/checkout`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${tokenResult.access_token}`,
                                      'Cookie': req.headers.get('cookie') || ''
                                    },
                                    body: JSON.stringify({
                                      authReqId: authResult.authReqId
                                    })
                                  });

                                  const checkoutResult = await checkoutResponse.json();

                                  if (checkoutResult.success) {
                                    const successMessage = `<div style="padding: 12px; border: 1px solid #28a745; border-radius: 6px; background-color: #f8fff9; font-family: Arial, sans-serif; font-size: 13px;">
  <div style="color: #28a745; font-weight: bold; margin-bottom: 8px; display: flex; align-items: center;">
    <span style="font-size: 16px; margin-right: 6px;">✅</span>
    Checkout Complete!
  </div>
  
  <div style="background-color: white; padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 12px; border-left: 3px solid #28a745;">
    <div style="font-weight: 600; color: #333; margin-bottom: 4px;">
      🎉 Order #${checkoutResult.order.orderId}
    </div>
    <div style="color: #666;">
      <strong>Total:</strong> $${checkoutResult.order.total.toFixed(2)} • 
      <strong>Items:</strong> ${checkoutResult.order.items.length} • 
      <strong>Date:</strong> ${new Date(checkoutResult.order.timestamp).toLocaleDateString()}
    </div>
  </div>
  
  <div style="font-size: 11px; color: #28a745; text-align: center; font-weight: 500;">
    🛒 Thank you for your purchase! Your cart has been cleared.
  </div>
</div>`;

                                    try {
                                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: successMessage })}\n\n`));
                                      controller.close(); // Close stream on success
                                    } catch (controllerError) {
                                      console.error('Controller already closed during success:', controllerError);
                                    }
                                  } else {
                                    const failureMessage = `<div style="padding: 12px; border: 1px solid #dc3545; border-radius: 6px; background-color: #fff5f5; font-family: Arial, sans-serif; font-size: 13px;">
  <div style="color: #dc3545; font-weight: bold; margin-bottom: 8px; display: flex; align-items: center;">
    <span style="font-size: 16px; margin-right: 6px;">❌</span>
    Checkout Failed
  </div>
  
  <div style="background-color: white; padding: 8px; border-radius: 4px; margin: 8px 0; font-size: 12px; border-left: 3px solid #dc3545;">
    <div style="color: #666;">
      ${checkoutResult.message || 'Unknown error occurred during checkout'}
    </div>
  </div>
  
  <div style="font-size: 11px; color: #dc3545; text-align: center;">
    Please try again or contact support if the issue persists.
  </div>
</div>`;
                                    try {
                                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: failureMessage })}\n\n`));
                                      controller.close(); // Close stream on failure
                                    } catch (controllerError) {
                                      console.error('Controller already closed during failure:', controllerError);
                                    }
                                  }
                                  return; // Exit polling
                                  
                                } else if (tokenResult.status === 'denied' || tokenResult.status === 'access_denied') {
                                  try {
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Authorization was denied. Checkout cancelled.' })}\n\n`));
                                    controller.close(); // Close stream on denial
                                  } catch (controllerError) {
                                    console.error('Controller already closed during denial:', controllerError);
                                  }
                                  return; // Exit polling
                                  
                                } else if (tokenResult.status === 'pending' || tokenResult.status === 'authorization_pending') {
                                  // Continue polling
                                  if (attempts % 30 === 0) { // Update every 30 seconds
                                    try {
                                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n⏳ Still waiting for authorization... (${Math.floor((maxAttempts - attempts) / 60)} minutes remaining)` })}\n\n`));
                                    } catch (controllerError) {
                                      console.error('Controller already closed during pending update:', controllerError);
                                      return; // Exit polling if controller is closed
                                    }
                                  }
                                  continue;
                                  
                                } else {
                                  // Unknown status or error
                                  console.error('Unknown CIBA status:', tokenResult);
                                  try {
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n❌ Unexpected authorization response. Please try checkout again.` })}\n\n`));
                                    controller.close(); // Close stream on unknown status
                                  } catch (controllerError) {
                                    console.error('Controller already closed during unknown status:', controllerError);
                                  }
                                  return; // Exit polling
                                }
                                
                              } catch (pollError) {
                                console.error('CIBA polling error:', pollError);
                                try {
                                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Error checking authorization status.' })}\n\n`));
                                  controller.close(); // Close stream on polling error
                                } catch (controllerError) {
                                  console.error('Controller already closed during polling error:', controllerError);
                                }
                                return; // Exit polling
                              }
                            }
                            
                            // Timeout reached
                            try {
                              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n⏰ Authorization request timed out. Please try again.' })}\n\n`));
                              controller.close(); // Close stream on timeout
                            } catch (controllerError) {
                              console.error('Controller already closed during timeout:', controllerError);
                            }
                          };
                          
                          // Start polling in background (don't await to keep stream alive)
                          hasAsyncOperation = true; // Mark that we have an async operation
                          console.log('Starting async operation - hasAsyncOperation set to:', hasAsyncOperation);
                          pollForAuthorization().catch(error => {
                            console.error('Polling error:', error);
                            try {
                              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Error during authorization process.' })}\n\n`));
                              controller.close(); // Close stream on error
                            } catch (controllerError) {
                              console.error('Controller already closed:', controllerError);
                            }
                          });
                          
                          // Don't return - continue processing but skip closing the controller

                        } else {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n❌ ${authResult.message || 'Failed to initiate checkout authorization'}` })}\n\n`));
                        }
                      } catch (error) {
                        console.error('Async checkout error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, there was an error initiating the checkout process.' })}\n\n`));
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
