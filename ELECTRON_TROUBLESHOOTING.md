# Electron Troubleshooting Guide

I've diagnosed and implemented fixes for the blank screen issue. Here's what to try:

## 🔧 Updated Fixes Applied

1. **Port Detection & Retry Logic**: Now tries multiple ports (5174, 5173, 5175, 5176)
2. **Server Health Check**: Validates server is responding before loading
3. **Better Error Handling**: Logs all connection attempts and failures
4. **Timing Fixes**: Waits for server to be ready before connection

## 🧪 Testing Steps

### Step 1: Check Webview Server

```bash
# In one terminal, manually start webview server
cd webview-ui
npm run dev
```

Look for output like:

```
VITE v6.3.5  ready in 354 ms
➜  Local:   http://localhost:5174/
```

### Step 2: Test Server in Browser

Open http://localhost:5174 in your browser - you should see the Kilo Code interface.

### Step 3: Test Electron Connection

```bash
# In another terminal
cd apps/electron-app
npm run build:main
npx electron dist/main.js
```

Watch console output for:

```
🔧 Development mode: true
🔒 Web security: disabled (dev only)
🌐 Attempt 1: Trying to load webview from: http://localhost:5174
✅ Successfully loaded from port 5174
```

## 🐛 Common Issues & Solutions

### Issue: "Connection Refused"

**Symptoms**: Electron shows blank screen, console shows connection refused
**Solution**:

1. Ensure webview dev server is running first
2. Check the port number in console output
3. Try manual browser test first

### Issue: "Blank Screen After Loading"

**Symptoms**: No connection errors but screen stays blank
**Possible Causes**:

1. **React Errors**: Check Electron dev tools console for JavaScript errors
2. **CORS Issues**: Dev tools network tab shows failed resource loads
3. **Content Security Policy**: CSP blocking resources

**Debug Steps**:

1. Open Electron dev tools (should open automatically)
2. Check Console tab for React/JS errors
3. Check Network tab for failed resource loads
4. Look for CSP violations in console

### Issue: "Security Warnings"

**Symptoms**: Red security warnings in console
**Status**: ✅ **Expected in Development** - These warnings are intentional and disappear in production builds.

## 🔍 Enhanced Diagnostics

The updated Electron app now provides detailed logging:

- ✅ **Connection attempts**: Shows each port being tested
- ✅ **Server health**: Validates server response before loading
- ✅ **Error details**: Logs specific connection failures
- ✅ **Renderer errors**: Forwards React errors to main console

## 📋 Next Steps

If you're still seeing a blank screen:

1. **Run the manual test sequence above**
2. **Share the console output** from both webview server and Electron
3. **Check browser dev tools** for any React/JS errors
4. **Verify the webview server works** in a regular browser first

The enhanced error handling should now provide much clearer information about what's failing!
