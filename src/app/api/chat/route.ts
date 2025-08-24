import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const POST = async (req: NextRequest) => {
  console.log('Weather tool working!');
  try {
    const { messages } = await req.json();

    const systemMessage = {
      role: 'system' as const,
      content: 'You are a helpful AI assistant. You have access to two functions: "get_weather" for weather information and "get_calendar" for Google Calendar events. When users ask about weather, use get_weather. When users ask about their schedule, calendar, events, or appointments, use get_calendar. The calendar function requires user authorization - if they need to authorize, provide them with the authorization link.'
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