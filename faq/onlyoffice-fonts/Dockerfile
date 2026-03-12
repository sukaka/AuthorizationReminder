ARG ONLYOFFICE_DOCUMENTSERVER_8_1_1_IMAGE=onlyoffice/documentserver:8.1.1
FROM ${ONLYOFFICE_DOCUMENTSERVER_8_1_1_IMAGE}

USER root

ENV DEBIAN_FRONTEND=noninteractive

COPY 64-chinese-aliases.conf /tmp/64-chinese-aliases.conf

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
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
    fonts-noto-color-emoji \
  && cp /tmp/64-chinese-aliases.conf /etc/fonts/conf.d/64-chinese-aliases.conf \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache -f
