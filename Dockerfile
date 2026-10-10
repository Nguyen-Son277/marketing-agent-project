# syntax=docker/dockerfile:1
#
# Ảnh production cho hệ thống đội agent marketing.
#
# Hai giai đoạn vì lý do kích thước và an toàn: giai đoạn build cần toàn bộ
# devDependencies và toolchain để biên dịch better-sqlite3 và đóng gói giao diện;
# giai đoạn runtime chỉ cần node + node_modules production + artefact đã build.
# Nhờ vậy ảnh cuối không chứa trình biên dịch C++.
#
# Lưu ý quan trọng về native module: better-sqlite3 là module native, nên nó phải
# được build cho đúng nền tảng chạy. Ta build trong đúng ảnh nền
# (`node:22-bookworm-slim`) rồi copy nguyên node_modules sang, KHÔNG build ở máy
# host rồi copy vào — làm vậy sẽ hỏng trên kiến trúc khác.

# ---------------------------------------------------------------- giai đoạn build
FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true

# python3 + make + g++ là yêu cầu của node-gyp khi build better-sqlite3.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

WORKDIR /app

# Copy manifest trước để tận dụng cache layer: chỉ cài lại khi dependency đổi.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json       packages/shared/
COPY packages/db/package.json           packages/db/
COPY packages/llm/package.json          packages/llm/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/kb/package.json           packages/kb/
COPY packages/tools/package.json        packages/tools/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY apps/server/package.json           apps/server/
COPY apps/web/package.json              apps/web/
COPY seed/package.json                  seed/

# Store nằm trong image builder; không cần mount hay mạng ở bước sau.
RUN pnpm install --frozen-lockfile --store-dir /pnpm-store

# Copy phần còn lại của mã nguồn.
COPY . .

# Build giao diện (sinh apps/web/dist) rồi bỏ devDependencies của workspace web.
RUN pnpm --filter @marketing-agent/web build \
 && pnpm prune --prod

# ------------------------------------------------------------- giai đoạn runtime
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/marketing.db \
    COMPANIES_ROOT=/data/companies \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# curl cho HEALTHCHECK; tini làm PID 1 để tín hiệu SIGTERM tới được node.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

WORKDIR /app

# Chỉ copy những gì cần để chạy: mã nguồn TS (chạy bằng tsx), node_modules đã prune,
# giao diện đã build, seed và cấu hình pnpm để tsx phân giải workspace.
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/seed ./seed
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# chmod ở đây là bắt buộc: COPY giữ nguyên mode từ build context, và bit thực thi
# của tệp trong git không đáng tin trên mọi hệ thống checkout.
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && mkdir -p /data/companies \
 && chown -R node:node /app /data

# Chạy bằng user không phải root; volume /data phải ghi được bởi user này.
USER node

# Volume bền vững: chứa SQLite + kho kiến thức Markdown của mọi công ty.
# Mất volume này là mất toàn bộ dữ liệu nghiệp vụ.
VOLUME ["/data"]

EXPOSE 3000

# readyz kiểm tra catalog đã seed chưa, không chỉ tiến trình còn sống.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/readyz" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["start"]
