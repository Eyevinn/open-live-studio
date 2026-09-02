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

# nginx config — full security-header suite + SPA fallback (see nginx.conf.template).
# The template uses the %PORT% placeholder, substituted at container start by the CMD below.
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template

EXPOSE 8080

ENV PORT=8080

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# docker-entrypoint.sh renders default.conf from the template (substituting
# %PORT% and %CSP_CONNECT_SRC%) before exec'ing this CMD.
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
