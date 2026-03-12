ARG ONLYOFFICE_DOCUMENTSERVER_IMAGE=onlyoffice/documentserver:latest
FROM ${ONLYOFFICE_DOCUMENTSERVER_IMAGE}

USER root

ENV DEBIAN_FRONTEND=noninteractive

COPY 64-chinese-aliases.conf /tmp/64-chinese-aliases.conf

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
    if ! apt-cache show fonts-noto-cjk >/dev/null 2>&1; then \
      echo 'aliyun apt mirror failed, falling back to official debian mirrors' >&2; \
      write_official_sources; \
      apt-get update; \
    fi; \
    apt-get install -y --no-install-recommends \
      fonts-noto-cjk \
      fonts-noto-cjk-extra \
      fonts-wqy-zenhei \
      fonts-wqy-microhei \
      fonts-arphic-ukai \
      fonts-arphic-uming \
      fonts-arphic-gbsn00lp \
      fonts-arphic-gkai00mp \
      fonts-cwtex-kai \
      fonts-cwtex-fs \
      fonts-liberation2 \
      fonts-dejavu-core \
      fonts-freefont-ttf \
      fonts-noto-color-emoji; \
    cp /tmp/64-chinese-aliases.conf /etc/fonts/conf.d/64-chinese-aliases.conf; \
    rm -rf /var/lib/apt/lists/*; \
    fc-cache -f
