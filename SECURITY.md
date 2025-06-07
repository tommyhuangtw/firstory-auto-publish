# 🔒 Security Guidelines

## ⚠️ IMPORTANT: Credential Management

### **NEVER commit these files to git:**
- `config/google-credentials.json`
- `google-token.json`
- `.env` files with real values
- Any files containing API keys or secrets

### **Safe Setup Process:**

1. **Copy the example file:**
   ```bash
   cp config/google-credentials.example.json config/google-credentials.json
   ```

2. **Replace placeholder values** in `config/google-credentials.json` with your actual Google Service Account credentials

3. **Verify .gitignore** is working:
   ```bash
   git status
   # Should NOT show google-credentials.json as a new file
   ```

### **Environment Variables:**
Always use environment variables for sensitive data in production:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/credentials.json
AIRTABLE_API_KEY=your_api_key
AIRTABLE_BASE_ID=your_base_id
```

### **Deployment:**
- Use platform-specific secret management (Railway secrets, Vercel environment variables)
- Never hardcode credentials in source code
- Regularly rotate API keys and service account keys

## 🚨 If Credentials Are Exposed:

1. **Immediately revoke** the compromised service account key in Google Cloud Console
2. **Generate new credentials**
3. **Update all deployments** with new credentials
4. **Review access logs** for unauthorized usage

## 📞 Report Security Issues:
If you discover security vulnerabilities, please report them responsibly.