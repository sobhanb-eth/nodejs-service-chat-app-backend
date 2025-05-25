#!/bin/bash

# Secure Chat API - Azure App Service Deployment Script

set -e

echo "🚀 Deploying Secure Chat API to Azure App Service..."

# Configuration
RESOURCE_GROUP="secure-chat-rg"
APP_SERVICE_PLAN="secure-chat-plan"
WEB_APP_NAME="secure-chat-api-$(date +%s)"
LOCATION="East US"
SKU="B1"
RUNTIME="NODE:20-lts"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    print_error "Azure CLI is not installed. Please install it first:"
    echo "https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

# Check if logged in to Azure
if ! az account show &> /dev/null; then
    print_warning "Not logged in to Azure. Please login first:"
    az login
fi

print_status "Current Azure subscription:"
az account show --query "{name:name, id:id}" -o table

# Create resource group
print_status "Creating resource group: $RESOURCE_GROUP"
az group create \
    --name $RESOURCE_GROUP \
    --location "$LOCATION" \
    --output table

# Create App Service Plan
print_status "Creating App Service Plan: $APP_SERVICE_PLAN"
az appservice plan create \
    --name $APP_SERVICE_PLAN \
    --resource-group $RESOURCE_GROUP \
    --location "$LOCATION" \
    --sku $SKU \
    --is-linux \
    --output table

# Create Web App
print_status "Creating Web App: $WEB_APP_NAME"
az webapp create \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --plan $APP_SERVICE_PLAN \
    --runtime "$RUNTIME" \
    --output table

# Configure Web App settings
print_status "Configuring Web App settings..."

# Enable WebSockets for Socket.io
az webapp config set \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --web-sockets-enabled true \
    --always-on true \
    --output table

# Set application settings
print_status "Setting environment variables..."
az webapp config appsettings set \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --settings \
        NODE_ENV=production \
        PORT=8080 \
        WEBSITE_NODE_DEFAULT_VERSION=20.x \
        SCM_DO_BUILD_DURING_DEPLOYMENT=true \
        MONGODB_URI="mongodb+srv://sobhanbahramiv:KCGCqNZ1v1WP4P5y@realtimechataiapp.cvx6svz.mongodb.net/?retryWrites=true&w=majority&appName=RealTimeChatAiApp" \
        DATABASE_NAME=RealTimeChatAiApp \
        DATABASE_PASSWORD=KCGCqNZ1v1WP4P5y \
        CLERK_SECRET_KEY=sk_test_placeholder_for_development \
        CLERK_PUBLISHABLE_KEY=pk_test_Y2FzdWFsLXR1bmEtOC5jbGVyay5hY2NvdW50cy5kZXYk \
        CLERK_JWT_ISSUER=https://casual-tuna-8.clerk.accounts.dev \
        AWS_ACCESS_KEY_ID=AKIAWG3RNDZE3WQOPUOA \
        AWS_SECRET_ACCESS_KEY=Vrp4l1q2a8+sNv3ZaBKT5iWq0rtJffnoeKpxmkbgPS \
        AWS_DEFAULT_REGION=us-east-1 \
        S3_BUCKET_NAME=secure-realtime-chat-media-dev-iart7v14 \
        OPENAI_API_KEY=sk-your_openai_api_key_here \
        ENCRYPTION_SECRET_KEY=secure_chat_encryption_key_2024_azure_production \
        ALLOWED_ORIGINS="https://$WEB_APP_NAME.azurewebsites.net,https://localhost:3000,https://localhost:19006,https://localhost:8081,exp://localhost:8081" \
        SOCKET_IO_CORS_ORIGINS="https://$WEB_APP_NAME.azurewebsites.net,https://localhost:3000,https://localhost:19006,https://localhost:8081,exp://localhost:8081" \
    --output table

# Build and deploy the application
print_status "Building application..."
cd nodejs-service

# Install dependencies
npm ci --only=production

# Build TypeScript
npm run build

# Create deployment package
print_status "Creating deployment package..."
mkdir -p deployment
cp -r dist deployment/
cp package*.json deployment/
cp -r node_modules deployment/

# Deploy to Azure
print_status "Deploying to Azure App Service..."
az webapp deployment source config-zip \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --src deployment.zip

# Create zip file
cd deployment
zip -r ../deployment.zip . > /dev/null
cd ..

# Deploy
az webapp deployment source config-zip \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --src deployment.zip

# Clean up
rm -rf deployment deployment.zip

# Get the app URL
APP_URL="https://$WEB_APP_NAME.azurewebsites.net"

print_success "Deployment completed successfully!"
echo ""
echo "🌐 App URL: $APP_URL"
echo "📡 Socket.io URL: $APP_URL"
echo "🔍 Health Check: $APP_URL/health"
echo "📊 Azure Portal: https://portal.azure.com/#@/resource/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$WEB_APP_NAME"
echo ""
print_status "Testing deployment..."
sleep 30
curl -f "$APP_URL/health" && print_success "Health check passed!" || print_warning "Health check failed - app may still be starting"

echo ""
print_success "🎉 Azure deployment complete!"
echo "Update your mobile app to use: $APP_URL"
