# CanvasFlow - AI Chat Assistant

CanvasFlow is a streaming conversation web application based on Qwen AI, providing a ChatGPT-like user experience.

## Features

- 🎨 Modern dark theme UI design
- 💬 Real-time streaming conversation responses
- 📱 Responsive design supporting mobile devices
- 🔄 Multi-session management
- ⚡ Lightweight Flask-based backend
- 🤖 Integrated Qwen AI model

## Interface Features

- **Left Sidebar**: Conversation history list with support for creating new conversations
- **Right Upper Section**: Conversation display area with scrollable message history
- **Right Lower Section**: Message input area supporting multi-line input
- **Dark Theme**: Eye-friendly dark color scheme

## Tech Stack

### Frontend
- HTML5 + CSS3 + JavaScript (ES6+)
- Responsive design
- SSE (Server-Sent Events) for streaming data reception

### Backend
- Flask (Python Web Framework)
- OpenAI SDK (Qwen AI interface)
- Flask-CORS (Cross-origin support)

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Start Server

```bash
python app.py
```

### 3. Open Browser

Visit `http://localhost:5000` to start chatting

## Project Structure

```
CanvasFlow/
├── app.py              # Flask backend server
├── templates/
│   └── index.html      # Main page template
├── static/
│   ├── style.css       # Style file
│   └── script.js       # Frontend JavaScript
├── requirements.txt    # Python dependencies
└── README.md          # Project documentation
```

## API Endpoints

### Chat Interface
- **POST** `/api/chat` - Send messages and get streaming responses
- **GET** `/api/chats` - Get all chat sessions
- **GET** `/api/chats/<chat_id>` - Get specific chat session
- **DELETE** `/api/chats/<chat_id>` - Delete chat session

### Health Check
- **GET** `/api/health` - Server status check

## Configuration

### API Key Configuration
Configure your Qwen AI API key in `app.py`:

```python
api_key="your-api-key-here"
```

**Security Recommendation**: Use environment variables to manage API keys in production:

```bash
export QWEN_API_KEY="your-api-key-here"
```

Then use in code:
```python
api_key=os.getenv('QWEN_API_KEY')
```

## Usage Instructions

1. **Start Conversation**: Enter your question in the input box, press Enter to send
2. **Multi-line Input**: Use Shift+Enter to create new lines
3. **New Conversation**: Click the "New Chat" button on the left
4. **Switch Conversations**: Click on historical conversation items on the left
5. **Example Prompts**: Click example buttons on the welcome page to quickly start

## Key Features

### Streaming Response
- Real-time display of AI reply content
- ChatGPT-like typing effect
- Faster response user experience

### Multi-session Management
- Support for creating multiple independent conversations
- Automatic conversation history saving
- Intelligent conversation title generation

### Responsive Design
- Full functionality on desktop
- Optimized layout for mobile
- Tablet device adaptation

## Development Notes

### Frontend Development
- Main logic in `script.js`
- Style definitions in `style.css`
- Uses vanilla JavaScript, no build tools required

### Backend Development
- Based on Flask framework
- Supports hot reload debugging
- In-memory session data storage (can be extended to database)

## Deployment Suggestions

### Development Environment
```bash
python app.py
```

### Production Environment
```bash
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

## Notes

- Current version uses in-memory storage for chat history, data will be lost after server restart
- For production environments, recommend using Redis or database for session data storage
- Please keep API keys secure and do not commit them to version control systems

## License

This project is for learning and personal use only.

## Contact

For questions or suggestions, please contact the developer. 