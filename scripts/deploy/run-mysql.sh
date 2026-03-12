#!/usr/bin/env sh
set -eu

version="$(mysqld --version 2>/dev/null || true)"

case "$version" in
  *"Ver 8.4."*)
    exec docker-entrypoint.sh mysqld --mysql-native-password=ON
    ;;
  *)
    exec docker-entrypoint.sh mysqld
    ;;
esac
