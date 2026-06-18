# Stage 1: build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

# Stage 2: serve with nginx
FROM nginx:1.27-alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy built SPA
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx config — serve index.html for all routes (SPA fallback)
COPY <<'EOF' /etc/nginx/conf.d/default.conf.template
server {
    listen %PORT%;
    root /usr/share/nginx/html;
    index index.html;
    add_header X-Frame-Options "SAMEORIGIN" always;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

EXPOSE 8080

ENV PORT=8080

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/bin/sh", "-c", "sed s/%PORT%/$PORT/ /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
