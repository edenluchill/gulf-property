# SSL Certificates for upload-api.pinzos.com

This directory contains Cloudflare Origin Certificates for direct HTTPS connections
(bypassing Cloudflare proxy to allow uploads >100MB).

## Required Files

- `origin-cert.pem` - Cloudflare Origin Certificate
- `origin-key.pem` - Private key for the certificate

## How to Generate

1. Go to Cloudflare Dashboard → pinzos.com → SSL/TLS → Origin Server
2. Click "Create Certificate"
3. Select:
   - Private key type: RSA (2048)
   - Hostnames: `upload-api.pinzos.com`
   - Certificate Validity: 15 years (recommended)
4. Click "Create"
5. Copy the certificate and save as `origin-cert.pem`
6. Copy the private key and save as `origin-key.pem`

## DNS Configuration

In Cloudflare DNS, add:
- Type: A
- Name: upload-api
- Content: (Load Balancer IP)
- Proxy status: **DNS only** (gray cloud - NOT proxied!)

The gray cloud is critical - it allows direct connection to your server,
bypassing Cloudflare's 100MB request body limit.

## Security Notes

- NEVER commit the actual .pem files to git
- These files are in .gitignore
- The deployment script will upload them to /opt/pinzos/ssl/ on the server
