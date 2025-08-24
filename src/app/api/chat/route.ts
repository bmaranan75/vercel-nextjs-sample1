import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getProducts, addToCart, getCartWithProducts } from '../../../lib/shopping-store';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const POST = async (req: NextRequest) => {
  console.log('Weather tool working!');
  try {
    const { messages } = await req.json();

    const systemMessage = {
      role: 'system' as const,
      content: 'You are a helpful AI assistant with access to weather, calendar, and shopping functions. Use get_weather for weather, get_calendar for calendar events, list_products to show available products, add_to_cart to add items to cart, and view_cart to display cart contents. For shopping, always show product details clearly and format cart contents in a nice table.'
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
          name: 'list_products',
          description: 'List all available products with their details',
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
    const readable = new ReadableStream({
      async start(controller) {
        let toolCalls = [];
        let hasContent = false;
        
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          const finishReason = chunk.choices[0]?.finish_reason;
          
          if (delta?.content) {
            hasContent = true;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta.content })}\n\n`));
          }
          
          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index || 0;
              
              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' }
                };
              }
              
              if (toolCallDelta.id) {
                toolCalls[index].id += toolCallDelta.id;
              }
              if (toolCallDelta.function?.name) {
                toolCalls[index].function.name += toolCallDelta.function.name;
              }
              if (toolCallDelta.function?.arguments) {
                toolCalls[index].function.arguments += toolCallDelta.function.arguments;
              }
            }
          }
          
          if (finishReason === 'tool_calls' && toolCalls.length > 0) {
            const toolCall = toolCalls[0];
            if (toolCall.function.name === 'get_weather') {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                
                // Call OpenWeatherMap API
                const apiKey = process.env.OPENWEATHER_API_KEY;
                if (!apiKey) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Weather API key not configured.' })}\n\n`));
                  continue;
                }
                
                const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(args.city)}&appid=${apiKey}&units=metric`;
                console.log('Weather API URL:', weatherUrl.replace(apiKey, 'API_KEY_HIDDEN'));
                
                const weatherResponse = await fetch(weatherUrl);
                console.log('Weather API response status:', weatherResponse.status, weatherResponse.statusText);
                
                if (!weatherResponse.ok) {
                  const errorText = await weatherResponse.text();
                  console.log('Weather API error response:', errorText);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n❌ Could not find weather data for "${args.city}". API Error: ${weatherResponse.status} - ${weatherResponse.statusText}` })}\n\n`));
                  continue;
                }
                
                const weatherData = await weatherResponse.json();
                
                const formattedResponse = `

🌤️ **Weather in ${weatherData.name}, ${weatherData.sys.country}:**
- Temperature: ${Math.round(weatherData.main.temp)}°C (feels like ${Math.round(weatherData.main.feels_like)}°C)
- Conditions: ${weatherData.weather[0].description}
- Humidity: ${weatherData.main.humidity}%
- Wind Speed: ${weatherData.wind.speed} m/s
- Pressure: ${weatherData.main.pressure} hPa`;
                
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: formattedResponse })}\n\n`));
              } catch (error) {
                console.error('Weather API error:', error);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble getting the weather data.' })}\n\n`));
              }
            } else if (toolCall.function.name === 'get_calendar') {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                
                // Build calendar API URL with parameters
                const calendarUrl = new URL('/api/calendar', 'http://localhost:3000');
                if (args.timeMin) calendarUrl.searchParams.set('timeMin', args.timeMin);
                if (args.timeMax) calendarUrl.searchParams.set('timeMax', args.timeMax);
                
                const calendarResponse = await fetch(calendarUrl.toString(), {
                  headers: {
                    'Cookie': req.headers.get('Cookie') || ''
                  }
                });
                
                const calendarData = await calendarResponse.json();
                
                if (!calendarResponse.ok) {
                  if (calendarData.needsAuth) {
                    const authMessage = `

🔐 **Google Calendar Authorization Required**

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

📅 **Your Upcoming Calendar Events:**

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
                console.error('Calendar API error:', error);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble accessing your calendar.' })}\n\n`));
              }
            } else if (toolCall.function.name === 'list_products') {
              try {
                const products = getProducts();
                
                // Prepare table data for products
                const tableHeaders = ['ID', 'Product', 'Description', 'Price'];
                const tableRows = products.map(product => [
                  product.id,
                  product.name,
                  product.description,
                  `$${product.price.toFixed(2)}`
                ]);

                const responseData = {
                  content: "Here are all available products in our BRM Sari-Sari Store:",
                  tableData: {
                    title: "🛍️ BRM Sari-Sari Store - Product Catalog",
                    summary: `${products.length} products available. Use "Add [product name] to cart" or "Add product ID [number]" to add items.`,
                    headers: tableHeaders,
                    rows: tableRows
                  }
                };
                
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(responseData)}\n\n`));
              } catch (error) {
                console.error('Product listing error:', error);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble loading the products.' })}\n\n`));
              }
            } else if (toolCall.function.name === 'add_to_cart') {
              try {
                const args = JSON.parse(toolCall.function.arguments);
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
                  const product = products.find(p => p.id === productId);
                  const totalCost = (product?.price || 0) * quantity;
                  const formattedResponse = `

✅ **Item Added to Cart!**

🛒 **${product?.name}**
├ Quantity: ${quantity}
├ Unit Price: $${product?.price.toFixed(2)}
└ Total: $${totalCost.toFixed(2)}

💡 *Tip: Ask "show my cart" to see all items!*`;
                  
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: formattedResponse })}\n\n`));
                } else {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Product not found. Please check the product ID.' })}\n\n`));
                }
              } catch (error) {
                console.error('Add to cart error:', error);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble adding the item to your cart.' })}\n\n`));
              }
            } else if (toolCall.function.name === 'view_cart') {
              try {
                const session = await getSession();
                
                if (!session?.user?.sub) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ You need to be signed in to view your cart.' })}\n\n`));
                  continue;
                }
                
                const userId = session.user.sub;
                const cartData = getCartWithProducts(userId);
                
                if (cartData.items.length === 0) {
                  const emptyCartMessage = `

🛒 **Your BRM Sari-Sari Store Cart:**

Your cart is empty. Browse our products to start shopping!`;
                  
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: emptyCartMessage })}\n\n`));
                } else {
                  // Prepare table data for HTML table rendering
                  const tableHeaders = ['Product', 'Price', 'Qty', 'Subtotal'];
                  const tableRows = cartData.items.map(item => {
                    if (item.product) {
                      return [
                        item.product.name,
                        `$${item.product.price.toFixed(2)}`,
                        item.quantity.toString(),
                        `$${item.subtotal.toFixed(2)}`
                      ];
                    }
                    return ['', '', '', ''];
                  }).filter(row => row[0] !== '');

                  const summaryText = `🧾 Total: $${cartData.total.toFixed(2)}

📦 Items in cart: ${cartData.items.length}
💰 Ready to checkout!`;

                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                    content: `🛒 **Your BRM Sari-Sari Store Cart:**`,
                    tableData: {
                      title: '',
                      headers: tableHeaders,
                      rows: tableRows,
                      summary: summaryText
                    }
                  })}\n\n`));
                }
              } catch (error) {
                console.error('View cart error:', error);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble loading your cart.' })}\n\n`));
              }
            }
          }
        }
        
        if (!hasContent && toolCalls.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: 'I apologize, but I encountered an issue processing your request.' })}\n\n`));
        }
        
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    );
  }
};