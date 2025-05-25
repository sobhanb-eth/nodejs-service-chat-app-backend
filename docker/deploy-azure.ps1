# Secure Chat API - Azure App Service Deployment Script (PowerShell)

param(
    [string]$ResourceGroup = "secure-chat-rg",
    [string]$AppServicePlan = "secure-chat-plan",
    [string]$Location = "East US",
    [string]$Sku = "B1"
)

$ErrorActionPreference = "Stop"

# Generate unique web app name
$WebAppName = "secure-chat-api-$(Get-Date -Format 'yyyyMMddHHmmss')"

Write-Host "🚀 Deploying Secure Chat API to Azure App Service..." -ForegroundColor Blue
Write-Host "📋 Configuration:" -ForegroundColor Yellow
Write-Host "   Resource Group: $ResourceGroup" -ForegroundColor Gray
Write-Host "   App Service Plan: $AppServicePlan" -ForegroundColor Gray
Write-Host "   Web App Name: $WebAppName" -ForegroundColor Gray
Write-Host "   Location: $Location" -ForegroundColor Gray
Write-Host "   SKU: $Sku" -ForegroundColor Gray
Write-Host ""

# Check if Azure CLI is installed
try {
    az --version | Out-Null
    Write-Host "✅ Azure CLI is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Azure CLI is not installed. Please install it first:" -ForegroundColor Red
    Write-Host "https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Yellow
    exit 1
}

# Check if logged in to Azure
try {
    $account = az account show --query "name" -o tsv 2>$null
    if ($account) {
        Write-Host "✅ Logged in to Azure: $account" -ForegroundColor Green
    } else {
        throw "Not logged in"
    }
} catch {
    Write-Host "⚠️ Not logged in to Azure. Please login first:" -ForegroundColor Yellow
    az login
}

# Create resource group
Write-Host "📦 Creating resource group: $ResourceGroup" -ForegroundColor Blue
az group create --name $ResourceGroup --location $Location --output table

# Create App Service Plan
Write-Host "🏗️ Creating App Service Plan: $AppServicePlan" -ForegroundColor Blue
az appservice plan create `
    --name $AppServicePlan `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku $Sku `
    --is-linux `
    --output table

# Create Web App
Write-Host "🌐 Creating Web App: $WebAppName" -ForegroundColor Blue
az webapp create `
    --name $WebAppName `
    --resource-group $ResourceGroup `
    --plan $AppServicePlan `
    --runtime "NODE:20-lts" `
    --output table

# Configure Web App settings
Write-Host "⚙️ Configuring Web App settings..." -ForegroundColor Blue

# Enable WebSockets for Socket.io
az webapp config set `
    --name $WebAppName `
    --resource-group $ResourceGroup `
    --web-sockets-enabled true `
    --always-on true `
    --output table

# Set application settings
Write-Host "🔧 Setting environment variables..." -ForegroundColor Blue
az webapp config appsettings set `
    --name $WebAppName `
    --resource-group $ResourceGroup `
    --settings `
        NODE_ENV=production `
        PORT=8080 `
        WEBSITE_NODE_DEFAULT_VERSION=20.x `
        SCM_DO_BUILD_DURING_DEPLOYMENT=true `
        MONGODB_URI="mongodb+srv://sobhanbahramiv:KCGCqNZ1v1WP4P5y@realtimechataiapp.cvx6svz.mongodb.net/?retryWrites=true&w=majority&appName=RealTimeChatAiApp" `
        DATABASE_NAME=RealTimeChatAiApp `
        DATABASE_PASSWORD=KCGCqNZ1v1WP4P5y `
        CLERK_SECRET_KEY=sk_test_placeholder_for_development `
        CLERK_PUBLISHABLE_KEY=pk_test_Y2FzdWFsLXR1bmEtOC5jbGVyay5hY2NvdW50cy5kZXYk `
        CLERK_JWT_ISSUER=https://casual-tuna-8.clerk.accounts.dev `
        AWS_ACCESS_KEY_ID=AKIAWG3RNDZE3WQOPUOA `
        AWS_SECRET_ACCESS_KEY=Vrp4l1q2a8+sNv3ZaBKT5iWq0rtJffnoeKpxmkbgPS `
        AWS_DEFAULT_REGION=us-east-1 `
        S3_BUCKET_NAME=secure-realtime-chat-media-dev-iart7v14 `
        OPENAI_API_KEY=sk-your_openai_api_key_here `
        ENCRYPTION_SECRET_KEY=secure_chat_encryption_key_2024_azure_production `
        ALLOWED_ORIGINS="https://$WebAppName.azurewebsites.net,https://localhost:3000,https://localhost:19006,https://localhost:8081,exp://localhost:8081" `
        SOCKET_IO_CORS_ORIGINS="https://$WebAppName.azurewebsites.net,https://localhost:3000,https://localhost:19006,https://localhost:8081,exp://localhost:8081" `
    --output table

# Build and deploy the application
Write-Host "🔨 Building application..." -ForegroundColor Blue
Set-Location nodejs-service

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Blue
npm ci --only=production

# Build TypeScript
Write-Host "🏗️ Building TypeScript..." -ForegroundColor Blue
npm run build

# Create deployment package
Write-Host "📁 Creating deployment package..." -ForegroundColor Blue
if (Test-Path "deployment") {
    Remove-Item -Recurse -Force "deployment"
}
New-Item -ItemType Directory -Name "deployment" | Out-Null

Copy-Item -Recurse "dist" "deployment/"
Copy-Item "package*.json" "deployment/"
Copy-Item -Recurse "node_modules" "deployment/"

# Create zip file
Write-Host "📦 Creating deployment zip..." -ForegroundColor Blue
if (Test-Path "deployment.zip") {
    Remove-Item "deployment.zip"
}
Compress-Archive -Path "deployment/*" -DestinationPath "deployment.zip"

# Deploy to Azure
Write-Host "🚀 Deploying to Azure App Service..." -ForegroundColor Blue
az webapp deployment source config-zip `
    --name $WebAppName `
    --resource-group $ResourceGroup `
    --src "deployment.zip"

# Clean up
Remove-Item -Recurse -Force "deployment"
Remove-Item "deployment.zip"

# Get the app URL
$AppUrl = "https://$WebAppName.azurewebsites.net"

Write-Host ""
Write-Host "🎉 Deployment completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 App URL: $AppUrl" -ForegroundColor Cyan
Write-Host "📡 Socket.io URL: $AppUrl" -ForegroundColor Cyan
Write-Host "🔍 Health Check: $AppUrl/health" -ForegroundColor Cyan
Write-Host "📊 Azure Portal: https://portal.azure.com" -ForegroundColor Cyan
Write-Host ""

# Test deployment
Write-Host "🧪 Testing deployment..." -ForegroundColor Blue
Start-Sleep -Seconds 30

try {
    $response = Invoke-WebRequest -Uri "$AppUrl/health" -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Health check passed!" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Health check returned status: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️ Health check failed - app may still be starting" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "📱 Update your mobile app configuration:" -ForegroundColor Yellow
Write-Host "   EXPO_PUBLIC_API_URL=$AppUrl/api" -ForegroundColor Gray
Write-Host "   EXPO_PUBLIC_SOCKET_URL=$AppUrl" -ForegroundColor Gray
Write-Host ""
Write-Host "🎉 Azure deployment complete!" -ForegroundColor Green
