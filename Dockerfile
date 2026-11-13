# ZX Spectrum website: build the WebAssembly emulator, then serve it with nginx.
#
#   docker build -t zx-spectrum-online .
#   docker run --rm -p 8080:8080 zx-spectrum-online   # http://localhost:8080
#
# The server listens on $PORT (default 8080). hcode sets PORT to the project's
# runtime port.

# --- Stage 1: build dist/ with Emscripten and run the web tests ------------
FROM emscripten/emsdk:3.1.74 AS build
WORKDIR /src
COPY . .
RUN make PLAT=WEB && make test-web NODE="$(command -v node)"

# --- Stage 2: serve dist/ with nginx (runs as a non-root user) --------------
FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV PORT=8080
# The image's entrypoint fills in ${PORT} and writes conf.d/default.conf
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
