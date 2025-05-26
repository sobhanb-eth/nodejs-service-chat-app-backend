# Quick manual deployment for existing Azure Web App

# Build the application
Write-Host "Building application..." -ForegroundColor Yellow
npm ci
npm run build

# Create deployment package
Write-Host "Creating deployment package..." -ForegroundColor Yellow
$deployDir = "deploy-temp"
if (Test-Path $deployDir) {
    Remove-Item $deployDir -Recurse -Force
}
New-Item -ItemType Directory -Path $deployDir

# Copy necessary files
Copy-Item "dist/*" $deployDir -Recurse
Copy-Item "package.json" $deployDir
Copy-Item "package-lock.json" $deployDir

# Create web.config if it doesn't exist
if (-not (Test-Path "web.config")) {
    Write-Host "Creating web.config..." -ForegroundColor Yellow
    $webConfigContent = @'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <handlers>
      <add name="iisnode" path="dist/index.js" verb="*" modules="iisnode"/>
    </handlers>
    <rewrite>
      <rules>
        <rule name="NodeInspector" patternSyntax="ECMAScript" stopProcessing="true">
          <match url="^dist\/index.js\/debug[\/]?" />
        </rule>
        <rule name="StaticContent">
          <action type="Rewrite" url="public{REQUEST_URI}"/>
        </rule>
        <rule name="DynamicContent">
          <conditions>
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="True"/>
          </conditions>
          <action type="Rewrite" url="dist/index.js"/>
        </rule>
      </rules>
    </rewrite>
    <security>
      <requestFiltering>
        <hiddenSegments>
          <remove segment="bin"/>
        </hiddenSegments>
      </requestFiltering>
    </security>
    <httpErrors existingResponse="PassThrough" />
    <iisnode watchedFiles="web.config;*.js"/>
  </system.webServer>
</configuration>
'@
    $webConfigContent | Out-File -FilePath "$deployDir\web.config" -Encoding utf8
} else {
    Copy-Item "web.config" $deployDir
}

# Create zip file
Write-Host "Creating deployment zip..." -ForegroundColor Yellow
Compress-Archive -Path "$deployDir\*" -DestinationPath "deployment.zip" -Force

# Deploy to Azure
Write-Host "Deploying to Azure App Service..." -ForegroundColor Yellow
az webapp deployment source config-zip --name "SafeChatAi" --resource-group "SafeChatAi_group" --src "deployment.zip"

# Clean up
Remove-Item -Recurse -Force $deployDir
Write-Host "Deployment complete!" -ForegroundColor Green
