Rebuilds `app/src/main/assets/www/vendor/anthropic.js` (the Anthropic SDK bundled for the WebView):

    npm install
    npx esbuild entry.js --bundle --format=iife --global-name=AnthropicSDK --minify --platform=browser --outfile=../app/src/main/assets/www/vendor/anthropic.js
