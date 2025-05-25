# Node.js Real-Time Service

A real-time messaging service built with Node.js, Express, and Socket.io for the secure group chat application.

## Features

- **Real-time messaging** with Socket.io WebSockets
- **JWT authentication** integration with Clerk
- **Group management** with room-based messaging
- **Typing indicators** with automatic timeout
- **Read receipts** for message tracking
- **Online presence tracking** for users
- **Message history** with pagination
- **Session management** with automatic cleanup
- **Rate limiting** and security middleware

## Architecture

```
├── src/
│   ├── config/          # Configuration files
│   │   ├── database.ts  # MongoDB connection
│   │   ├── environment.ts # Environment variables
│   │   └── socket.ts    # Socket.io configuration
│   ├── services/        # Business logic services
│   │   ├── AuthService.ts      # JWT validation & user management
│   │   ├── MessageService.ts   # Message CRUD operations
│   │   └── PresenceService.ts  # Online status tracking
│   ├── middleware/      # Express & Socket.io middleware
│   │   └── auth.ts      # JWT authentication middleware
│   ├── handlers/        # Socket.io event handlers
│   │   ├── connectionHandler.ts # Connection/disconnection
│   │   ├── messageHandler.ts    # Message events
│   │   ├── groupHandler.ts      # Group join/leave events
│   │   └── presenceHandler.ts   # Typing & presence events
│   ├── types/           # TypeScript type definitions
│   │   └── socket.ts    # Socket.io event types
│   └── index.ts         # Main server entry point
```

## Setup

### Prerequisites

- Node.js 18+
- MongoDB Atlas account
- Clerk account for authentication

### Installation

1. Install dependencies:
```bash
npm install
```

2. Copy environment configuration:
```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:
```env
# Database
DATABASE_PASSWORD=your_mongodb_password

# Clerk Authentication
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key
CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_publishable_key
```

### Development

Start the development server:
```bash
npm run dev
```

The service will run on `http://localhost:3001`

### Production

Build and start:
```bash
npm run build
npm start
```

## API Endpoints

### HTTP Endpoints

- `GET /health` - Health check endpoint
- `GET /info` - Service information

### Socket.io Events

#### Authentication
- `authenticate` - Authenticate with JWT token
- `authentication_success` - Authentication successful
- `authentication_error` - Authentication failed

#### Groups
- `join_group` - Join a group room
- `leave_group` - Leave a group room
- `group_joined` - Successfully joined group
- `group_left` - Successfully left group

#### Messages
- `send_message` - Send a message to group
- `new_message` - Receive new message
- `message_sent` - Message sent confirmation
- `mark_message_read` - Mark message as read
- `message_read` - Message read receipt

#### Typing Indicators
- `typing_start` - Start typing indicator
- `typing_stop` - Stop typing indicator
- `user_typing` - User is typing notification
- `user_stopped_typing` - User stopped typing

#### Presence
- `get_online_users` - Get list of online users
- `online_users` - Online users list
- `user_online` - User came online
- `user_offline` - User went offline

## Database Collections

### Messages
```typescript
{
  _id: ObjectId,
  groupId: ObjectId,
  senderId: ObjectId,
  content: string,
  type: 'text' | 'image' | 'file' | 'system',
  isDeleted: boolean,
  readBy: [{ userId: ObjectId, readAt: Date }],
  createdAt: Date,
  updatedAt: Date
}
```

### Sessions
```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  socketId: string,
  status: 'online' | 'away' | 'offline',
  lastActivity: Date,
  deviceType: 'mobile' | 'web' | 'desktop',
  createdAt: Date,
  updatedAt: Date
}
```

## Integration

### With .NET Service
- Shares MongoDB database for Users and Groups
- Uses same JWT validation approach
- Runs on different port (3001 vs 5000)

### With Frontend
- Socket.io client connection
- JWT token from Clerk authentication
- Real-time event handling

## Security

- JWT token validation for all Socket.io connections
- CORS configuration for allowed origins
- Rate limiting for API endpoints
- Helmet security headers
- Input validation and sanitization

## Monitoring

- Health check endpoint for service monitoring
- Structured logging with Morgan
- Error handling and reporting
- Session cleanup and garbage collection

## Testing

Run tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

## Deployment

The service is designed to be deployed alongside the .NET service and can be containerized with Docker for production deployment.
