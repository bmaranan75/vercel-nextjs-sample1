import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0';
import { getProducts, addToCart, getCartWithProducts } from '../../../lib/shopping-store';

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

SHOPPING INSTRUCTIONS:
1. When users ask to ADD items to cart, use add_to_cart with the product ID immediately
2. When users ask to SEE products or BROWSE, use list_products to show available items
3. For adding items to cart, use the EXACT product ID (like 1, 2, 3, etc.) from the products list
4. Always confirm successful cart additions with a friendly message
5. Display cart contents in a clear table format with product names, prices, and quantities
6. When checking out, use async_checkout which will send a push notification for user authorization

OTHER FUNCTIONS:
- get_weather: Get current weather for any city
- get_calendar: View calendar events (requires user authorization)

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
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            
            if (delta?.content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: delta.content })}\n\n`));
            }

            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                if (toolCall.function?.name && toolCall.function?.arguments) {
                  try {
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    if (toolCall.function.name === 'get_weather') {
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
                    } else if (toolCall.function.name === 'list_products') {
                      try {
                        const products = getProducts();
                        
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
                          const product = products.find(p => p.id === productId || p.name.toLowerCase() === productId.toLowerCase());
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
                        const cartData = await getCartWithProducts(userId);

                        if (cartData.items.length === 0) {
                          const emptyCartResponse = `
🛒 **Your Cart is Empty**

No items in your cart yet. Browse our products and add some items!

💡 *Use "show products" to see what's available.*`;
                          
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: emptyCartResponse })}\n\n`));
                          continue;
                        }

                        let response = "\n\n🛒 **Your Shopping Cart**\n\n";
                        response += "| Item | Quantity | Unit Price | Subtotal |\n";
                        response += "|:-----|:---------|:-----------|:---------|\n";
                        
                        cartData.items.forEach(item => {
                          if (item.product) {
                            const subtotal = item.product.price * item.quantity;
                            response += `| **${item.product.name}** | ${item.quantity} | $${item.product.price.toFixed(2)} | $${subtotal.toFixed(2)} |\n`;
                          }
                        });
                        
                        response += `\n**Total: $${cartData.total.toFixed(2)}**\n\n`;
                        response += `💰 Ready to checkout!`;
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: response })}\n\n`));
                      } catch (error) {
                        console.error('View cart error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, I had trouble accessing your cart.' })}\n\n`));
                      }
                    } else if (toolCall.function.name === 'async_checkout') {
                      try {
                        const session = await getSession();
                        
                        if (!session?.user?.sub) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ You need to be signed in to checkout.' })}\n\n`));
                          continue;
                        }

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n🛒 **Initiating Secure Checkout...**\n\nStarting authorization process...' })}\n\n`));

                        // Call the checkout authorization API
                        const authResponse = await fetch(`${req.url.split('/api/chat')[0]}/api/checkout-auth`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Cookie': req.headers.get('cookie') || ''
                          },
                        });

                        const authResult = await authResponse.json();

                        if (authResult.success && authResult.requiresAuthorization) {
                          const authMessage = `
🔐 **Authorization Required**

📱 **Please check your Auth0 Guardian app for a push notification.**

**Checkout Details:**
• Items: ${authResult.checkout.itemCount}
• Total: $${authResult.checkout.total.toFixed(2)}
• Authorization Message: "${authResult.checkout.bindingMessage}"

⏳ Waiting for your approval...

*Note: In a real implementation, you would receive a push notification on your registered device through Auth0 Guardian. For this demo, the system will simulate the approval process.*`;

                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: authMessage,
                            authReqId: authResult.authReqId,
                            requiresAuth: true 
                          })}\n\n`));

                          // Simulate user approval after 3 seconds (in real implementation, this would come from Auth0 Guardian)
                          setTimeout(async () => {
                            try {
                              // Simulate approval
                              await fetch(`${req.url.split('/api/chat')[0]}/api/ciba-token`, {
                                method: 'PUT',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                  authReqId: authResult.authReqId,
                                  action: 'approve'
                                })
                              });

                              // Get the access token
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

                              if (tokenResult.status === 'approved') {
                                // Now complete the actual checkout
                                const checkoutResponse = await fetch(`${req.url.split('/api/chat')[0]}/api/checkout`, {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${tokenResult.access_token}`,
                                    'Cookie': req.headers.get('cookie') || ''
                                  },
                                });

                                const checkoutResult = await checkoutResponse.json();

                                if (checkoutResult.success) {
                                  const successMessage = `

✅ **Checkout Completed Successfully!**

🎉 **Order Confirmed**
• Order ID: **${checkoutResult.order.orderId}**
• Total Amount: **$${checkoutResult.order.total.toFixed(2)}**
• Items: **${checkoutResult.order.items.length}**
• Timestamp: ${new Date(checkoutResult.order.timestamp).toLocaleString()}

Your order has been processed and your cart has been cleared. Thank you for your purchase!

*This checkout was secured using Auth0 for AI's Client Initiated Backchannel Authentication (CIBA) pattern.*`;

                                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: successMessage })}\n\n`));
                                } else {
                                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n❌ Checkout failed: ${checkoutResult.message || 'Unknown error'}` })}\n\n`));
                                }
                              } else {
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Authorization was denied. Checkout cancelled.' })}\n\n`));
                              }
                            } catch (error) {
                              console.error('Async checkout completion error:', error);
                              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, there was an error completing the checkout after authorization.' })}\n\n`));
                            }
                          }, 3000);

                        } else {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `\n\n❌ ${authResult.message || 'Failed to initiate checkout authorization'}` })}\n\n`));
                        }
                      } catch (error) {
                        console.error('Async checkout error:', error);
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n\n❌ Sorry, there was an error initiating the checkout process.' })}\n\n`));
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
          controller.close();
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
