# ElevIQ SFA web app - static build served by nginx
# Build from the repo root:  docker build -f client/Dockerfile -t eleviq-web .
FROM node:20-alpine AS build
WORKDIR /app
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1
