#!/bin/bash

# Secure Chat Backend - Docker Startup Script

echo "🐳 Starting Secure Chat Backend with Docker..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Function to start development environment
start_dev() {
    echo "🚀 Starting development environment..."
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
    
    echo "⏳ Waiting for services to be ready..."
    sleep 10
    
    echo "📊 Service Status:"
    docker-compose ps
    
    echo ""
    echo "✅ Development environment started!"
    echo "🔗 Services available at:"
    echo "   📡 Node.js API: http://localhost:3001"
    echo "   🗄️  MongoDB: mongodb://localhost:27017"
    echo "   🔴 Redis: redis://localhost:6379"
    echo ""
    echo "📝 To view logs: docker-compose logs -f"
    echo "🛑 To stop: docker-compose down"
}

# Function to start production environment
start_prod() {
    echo "🚀 Starting production environment..."
    docker-compose up --build -d
    
    echo "⏳ Waiting for services to be ready..."
    sleep 15
    
    echo "📊 Service Status:"
    docker-compose ps
    
    echo ""
    echo "✅ Production environment started!"
    echo "🔗 Services available at:"
    echo "   📡 Node.js API: http://localhost:3001"
    echo ""
    echo "📝 To view logs: docker-compose logs -f"
    echo "🛑 To stop: docker-compose down"
}

# Function to stop all services
stop_services() {
    echo "🛑 Stopping all services..."
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml down
    echo "✅ All services stopped!"
}

# Function to clean up everything
cleanup() {
    echo "🧹 Cleaning up Docker resources..."
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml down -v --remove-orphans
    docker system prune -f
    echo "✅ Cleanup complete!"
}

# Function to show logs
show_logs() {
    echo "📝 Showing service logs..."
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f
}

# Function to show help
show_help() {
    echo "Secure Chat Backend - Docker Management"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  dev      Start development environment with hot reload"
    echo "  prod     Start production environment"
    echo "  stop     Stop all services"
    echo "  logs     Show service logs"
    echo "  cleanup  Stop services and clean up Docker resources"
    echo "  help     Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 dev     # Start development environment"
    echo "  $0 logs    # View logs"
    echo "  $0 stop    # Stop all services"
}

# Main script logic
case "${1:-dev}" in
    "dev")
        start_dev
        ;;
    "prod")
        start_prod
        ;;
    "stop")
        stop_services
        ;;
    "logs")
        show_logs
        ;;
    "cleanup")
        cleanup
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
