@echo off
REM Secure Chat Backend - Docker Startup Script for Windows

echo 🐳 Starting Secure Chat Backend with Docker...

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

REM Parse command line argument
set COMMAND=%1
if "%COMMAND%"=="" set COMMAND=dev

if "%COMMAND%"=="dev" goto start_dev
if "%COMMAND%"=="prod" goto start_prod
if "%COMMAND%"=="stop" goto stop_services
if "%COMMAND%"=="logs" goto show_logs
if "%COMMAND%"=="cleanup" goto cleanup
if "%COMMAND%"=="help" goto show_help
if "%COMMAND%"=="-h" goto show_help
if "%COMMAND%"=="--help" goto show_help

echo ❌ Unknown command: %COMMAND%
echo.
goto show_help

:start_dev
echo 🚀 Starting development environment...
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d

echo ⏳ Waiting for services to be ready...
timeout /t 10 /nobreak >nul

echo 📊 Service Status:
docker-compose ps

echo.
echo ✅ Development environment started!
echo 🔗 Services available at:
echo    📡 Node.js API: http://localhost:3001
echo    🗄️  MongoDB: MongoDB Atlas (Cloud)
echo.
echo 📝 To view logs: docker-compose logs -f
echo 🛑 To stop: docker-compose down
goto end

:start_prod
echo 🚀 Starting production environment...
docker-compose up --build -d

echo ⏳ Waiting for services to be ready...
timeout /t 15 /nobreak >nul

echo 📊 Service Status:
docker-compose ps

echo.
echo ✅ Production environment started!
echo 🔗 Services available at:
echo    📡 Node.js API: http://localhost:3001
echo.
echo 📝 To view logs: docker-compose logs -f
echo 🛑 To stop: docker-compose down
goto end

:stop_services
echo 🛑 Stopping all services...
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down
echo ✅ All services stopped!
goto end

:cleanup
echo 🧹 Cleaning up Docker resources...
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down -v --remove-orphans
docker system prune -f
echo ✅ Cleanup complete!
goto end

:show_logs
echo 📝 Showing service logs...
docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f
goto end

:show_help
echo Secure Chat Backend - Docker Management
echo.
echo Usage: %0 [COMMAND]
echo.
echo Commands:
echo   dev      Start development environment with hot reload
echo   prod     Start production environment
echo   stop     Stop all services
echo   logs     Show service logs
echo   cleanup  Stop services and clean up Docker resources
echo   help     Show this help message
echo.
echo Examples:
echo   %0 dev     # Start development environment
echo   %0 logs    # View logs
echo   %0 stop    # Stop all services
goto end

:end
if "%COMMAND%"=="dev" (
    echo.
    echo Press any key to view logs, or Ctrl+C to exit...
    pause >nul
    goto show_logs
)
pause
