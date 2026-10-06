# challenger

Scanner software for Shuttle+ SG15

# HowTo

```shell
# ∠( ᐛ 」∠)_
pnpn install
# 〜〜(／￣▽)／　〜ф
bun prisma generate
# _(:3 」∠)_
cat >.env <<'EOF'
DATABASE_URL="postgres://..."
OPENAI_API_KEY="LOL"
OPENAI_BASE_URL="https://localhost"
OPENAI_MODEL="llama"
SHUTTLE_SERVER_PORT="1134"
WEB_SERVER_PORT="8080"
EOF
```