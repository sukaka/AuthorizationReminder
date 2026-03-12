ARG NODE_20_BOOKWORM_SLIM_IMAGE=node:20-bookworm-slim
FROM ${NODE_20_BOOKWORM_SLIM_IMAGE}

WORKDIR /app

RUN set -eux; \
    write_aliyun_sources() { \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        printf '%s\n' \
          'Types: deb' \
          'URIs: http://mirrors.cloud.aliyuncs.com/debian' \
          'Suites: bookworm bookworm-updates' \
          'Components: main' \
          'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
          '' \
          'Types: deb' \
          'URIs: http://mirrors.cloud.aliyuncs.com/debian-security' \
          'Suites: bookworm-security' \
          'Components: main' \
          'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
          > /etc/apt/sources.list.d/debian.sources; \
      else \
        printf '%s\n' \
          'deb http://mirrors.cloud.aliyuncs.com/debian bookworm main' \
          'deb http://mirrors.cloud.aliyuncs.com/debian bookworm-updates main' \
          'deb http://mirrors.cloud.aliyuncs.com/debian-security bookworm-security main' \
          > /etc/apt/sources.list; \
      fi; \
    }; \
    write_official_sources() { \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        printf '%s\n' \
          'Types: deb' \
          'URIs: http://deb.debian.org/debian' \
          'Suites: bookworm bookworm-updates' \
          'Components: main' \
          'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
          '' \
          'Types: deb' \
          'URIs: http://deb.debian.org/debian-security' \
          'Suites: bookworm-security' \
          'Components: main' \
          'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
          > /etc/apt/sources.list.d/debian.sources; \
      else \
        printf '%s\n' \
          'deb http://deb.debian.org/debian bookworm main' \
          'deb http://deb.debian.org/debian bookworm-updates main' \
          'deb http://deb.debian.org/debian-security bookworm-security main' \
          > /etc/apt/sources.list; \
      fi; \
    }; \
    write_aliyun_sources; \
    apt-get update; \
    if ! apt-cache show libreoffice >/dev/null 2>&1; then \
      echo 'aliyun apt mirror failed, falling back to official debian mirrors' >&2; \
      write_official_sources; \
      apt-get update; \
    fi; \
    apt-get install -y --no-install-recommends libreoffice; \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com \
 && npm ci --omit=dev

COPY src ./src

EXPOSE 5187
CMD ["npm", "start"]
