ARG ONLYOFFICE_DOCUMENTSERVER_IMAGE=onlyoffice/documentserver:latest
FROM ${ONLYOFFICE_DOCUMENTSERVER_IMAGE}

USER root

ENV DEBIAN_FRONTEND=noninteractive

COPY 64-chinese-aliases.conf /tmp/64-chinese-aliases.conf

RUN set -eux; \
    . /etc/os-release; \
    DIST_ID="${ID:-}"; \
    DIST_CODENAME="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"; \
    DIST_ARCH="$(dpkg --print-architecture)"; \
    write_aliyun_sources() { \
      if [ "$DIST_ID" = "ubuntu" ]; then \
        if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then \
          printf '%s\n' \
            'Types: deb' \
            'URIs: http://mirrors.aliyun.com/ubuntu/' \
            "Suites: ${DIST_CODENAME} ${DIST_CODENAME}-updates ${DIST_CODENAME}-backports" \
            'Components: main restricted universe multiverse' \
            'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' \
            '' \
            'Types: deb' \
            'URIs: http://mirrors.aliyun.com/ubuntu/' \
            "Suites: ${DIST_CODENAME}-security" \
            'Components: main restricted universe multiverse' \
            'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' \
            > /etc/apt/sources.list.d/ubuntu.sources; \
        else \
          printf '%s\n' \
            "deb http://mirrors.aliyun.com/ubuntu/ ${DIST_CODENAME} main restricted universe multiverse" \
            "deb http://mirrors.aliyun.com/ubuntu/ ${DIST_CODENAME}-updates main restricted universe multiverse" \
            "deb http://mirrors.aliyun.com/ubuntu/ ${DIST_CODENAME}-backports main restricted universe multiverse" \
            "deb http://mirrors.aliyun.com/ubuntu/ ${DIST_CODENAME}-security main restricted universe multiverse" \
            > /etc/apt/sources.list; \
        fi; \
      elif [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        printf '%s\n' \
          'Types: deb' \
          'URIs: http://mirrors.aliyun.com/debian' \
          'Suites: bookworm bookworm-updates' \
          'Components: main' \
          'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
          '' \
          'Types: deb' \
          'URIs: http://mirrors.aliyun.com/debian-security' \
          'Suites: bookworm-security' \
          'Components: main' \
          'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
          > /etc/apt/sources.list.d/debian.sources; \
      else \
        printf '%s\n' \
          'deb http://mirrors.aliyun.com/debian bookworm main' \
          'deb http://mirrors.aliyun.com/debian bookworm-updates main' \
          'deb http://mirrors.aliyun.com/debian-security bookworm-security main' \
          > /etc/apt/sources.list; \
      fi; \
    }; \
    write_official_sources() { \
      if [ "$DIST_ID" = "ubuntu" ]; then \
        if [ "$DIST_ARCH" = "amd64" ] || [ "$DIST_ARCH" = "i386" ]; then \
          UBUNTU_MAIN_URI='http://archive.ubuntu.com/ubuntu/'; \
          UBUNTU_SECURITY_URI='http://security.ubuntu.com/ubuntu/'; \
        else \
          UBUNTU_MAIN_URI='http://ports.ubuntu.com/ubuntu-ports/'; \
          UBUNTU_SECURITY_URI='http://ports.ubuntu.com/ubuntu-ports/'; \
        fi; \
        if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then \
          printf '%s\n' \
            'Types: deb' \
            "URIs: ${UBUNTU_MAIN_URI}" \
            "Suites: ${DIST_CODENAME} ${DIST_CODENAME}-updates ${DIST_CODENAME}-backports" \
            'Components: main restricted universe multiverse' \
            'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' \
            '' \
            'Types: deb' \
            "URIs: ${UBUNTU_SECURITY_URI}" \
            "Suites: ${DIST_CODENAME}-security" \
            'Components: main restricted universe multiverse' \
            'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' \
            > /etc/apt/sources.list.d/ubuntu.sources; \
        else \
          printf '%s\n' \
            "deb ${UBUNTU_MAIN_URI} ${DIST_CODENAME} main restricted universe multiverse" \
            "deb ${UBUNTU_MAIN_URI} ${DIST_CODENAME}-updates main restricted universe multiverse" \
            "deb ${UBUNTU_MAIN_URI} ${DIST_CODENAME}-backports main restricted universe multiverse" \
            "deb ${UBUNTU_SECURITY_URI} ${DIST_CODENAME}-security main restricted universe multiverse" \
            > /etc/apt/sources.list; \
        fi; \
      elif [ -f /etc/apt/sources.list.d/debian.sources ]; then \
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
    if ! apt-get update; then \
      echo 'aliyun apt update failed, falling back to official mirrors' >&2; \
      write_official_sources; \
      apt-get update; \
    fi; \
    if ! apt-cache show fonts-noto-cjk >/dev/null 2>&1; then \
      echo 'aliyun apt mirror failed, falling back to official mirrors' >&2; \
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
