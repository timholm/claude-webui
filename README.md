# Claude WebUI

Low-bandwidth terminal interface for Claude CLI via SSH/tmux.

## Features

- Clean REST API for terminal interaction
- Server-side key translation (up/down/tab/enter → tmux keys)
- Mobile-friendly with keyboard support
- Long-polling for efficient updates
- Deployed via ArgoCD + Helm

## Quick Start

### ArgoCD Deployment

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: claude-webui
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/timholm/claude-webui.git
    targetRevision: HEAD
    path: chart
  destination:
    server: https://kubernetes.default.svc
    namespace: claude-webui
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
    - CreateNamespace=true
```

### Create SSH Secret (required)

```bash
kubectl create secret generic claude-webui-secret \
  --from-literal=ssh-password='YOUR_PASSWORD' \
  -n claude-webui
```

## Configuration

See `chart/values.yaml` for all options:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image | `192.168.8.197:30500/claude-webui` |
| `image.tag` | Image tag | `v14` |
| `ssh.host` | SSH target host | `192.168.8.116` |
| `ssh.user` | SSH username | `tim` |
| `ssh.secretName` | K8s secret name | `claude-webui-secret` |
| `cmdApi.url` | CMD API URL | `http://10.43.215.37` |
| `httpRoute.enabled` | Enable HTTPRoute | `true` |
| `httpRoute.hostname` | Ingress hostname | `holm.chat` |
| `httpRoute.path` | URL path prefix | `/claude` |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Connection status |
| `/api/new` | POST | Start new Claude session |
| `/api/resume` | POST | Resume previous session |
| `/api/send` | POST | Send text `{"text": "..."}` |
| `/api/key` | POST | Send key `{"key": "up\|down\|enter\|tab\|..."}` |
| `/api/output` | GET | Get terminal output |
| `/api/kill` | POST | Kill session |

## Development

### Update Code

1. Edit `server.js` or `public/index.html`
2. Copy to chart: `cp server.js chart/files/ && cp public/index.html chart/files/`
3. Commit and push: `git add -A && git commit -m "update" && git push`
4. ArgoCD auto-syncs

### Local Testing

```bash
npm install
SSH_HOST=192.168.8.116 SSH_USER=tim SSH_PASS=xxx CMD_API_URL=http://localhost:3001 node server.js
```

## Architecture

```
Browser → Claude WebUI API → cmd.holm.chat → SSH → Mac → tmux → Claude CLI
```
