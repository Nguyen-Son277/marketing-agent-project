FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium xvfb openbox xdotool xclip imagemagick x11-utils fonts-noto-core fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /opt/marketing-agent
COPY --chown=node:node package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./
COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node apps/browser-worker ./apps/browser-worker
RUN pnpm --filter @marketing-agent/browser-worker... install --frozen-lockfile \
    && mkdir -p /home/node/profile && chown node:node /home/node/profile
USER node
ENV DISPLAY=:99 BROWSER_WORKER_HOST=0.0.0.0 BROWSER_WORKER_PORT=4090
EXPOSE 4090
ENTRYPOINT ["bash", "apps/browser-worker/entrypoint.sh"]
