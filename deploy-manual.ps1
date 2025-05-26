# Manual deployment script for Azure App Service
# Run this if GitHub Actions is having issues

Write-Host "🚀 Starting manual deployment to Azure App Service..." -ForegroundColor Green

# Check if Azure CLI is installed
try {
    az --version | Out-Null
    Write-Host "✅ Azure CLI found" -ForegroundColor Green
} catch {
    Write-Host "❌ Azure CLI not found. Please install Azure CLI first." -ForegroundColor Red
    exit 1
}

# Build the application
Write-Host "📦 Building application..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build completed successfully" -ForegroundColor Green

# Create deployment package
Write-Host "📦 Creating deployment package..." -ForegroundColor Yellow

# Create a temporary deployment directory
$deployDir = "deploy-temp"
if (Test-Path $deployDir) {
    Remove-Item $deployDir -Recurse -Force
}
New-Item -ItemType Directory -Path $deployDir

# Copy necessary files
Copy-Item "dist/*" $deployDir -Recurse
Copy-Item "package.json" $deployDir
Copy-Item "package-lock.json" $deployDir
Copy-Item "web.config" $deployDir

Write-Host "✅ Deployment package created" -ForegroundColor Green

# Deploy to Azure
Write-Host "🌐 Deploying to Azure App Service..." -ForegroundColor Yellow

try {
    # Login to Azure (if not already logged in)
    $account = az account show 2>$null
    if (-not $account) {
        Write-Host "🔐 Please login to Azure..." -ForegroundColor Yellow
        az login
    }

    # Deploy using Azure CLI
    az webapp deploy --resource-group "DefaultResourceGroup-EUS" --name "SafeChatAi" --src-path $deployDir --type zip

    if ($LASTEXITCODE -eq 0) {
        Write-Host "🎉 Deployment completed successfully!" -ForegroundColor Green
        Write-Host "🌐 App URL: https://safechatai.azurewebsites.net" -ForegroundColor Cyan
        Write-Host "📡 Socket.io URL: https://safechatai.azurewebsites.net" -ForegroundColor Cyan
        Write-Host "🔍 Health Check: https://safechatai.azurewebsites.net/health" -ForegroundColor Cyan
    } else {
        Write-Host "❌ Deployment failed!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Deployment failed: $_" -ForegroundColor Red
    exit 1
} finally {
    # Clean up
    if (Test-Path $deployDir) {
        Remove-Item $deployDir -Recurse -Force
    }
}

Write-Host "✅ Manual deployment completed!" -ForegroundColor Green
