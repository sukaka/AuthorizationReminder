import os
import re
from collections.abc import Callable, Mapping
from typing import Any

import pymysql


IDENTIFIER = re.compile(r"^[A-Za-z0-9_]+$")
SCHEMA_PRIVILEGES = (
    "SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES"
)


def validate_identifier(value: str) -> str:
    normalized = str(value or "")
    if not IDENTIFIER.fullmatch(normalized):
        raise ValueError("数据库名或账号格式无效")
    return normalized


def bootstrap_database(
    environment: Mapping[str, str],
    *,
    connect: Callable[..., Any] = pymysql.connect,
) -> None:
    database = validate_identifier(
        environment.get("MYSQL_DATABASE", "juxin_ai_assistant")
    )
    app_user = validate_identifier(
        environment.get("MYSQL_USER", "ai_assistant_user")
    )
    app_password = environment["MYSQL_PASSWORD"]
    connection = connect(
        host=environment.get("MYSQL_HOST", "mysql"),
        port=int(environment.get("MYSQL_PORT", "3306")),
        user=environment.get("MYSQL_ADMIN_USER", "root"),
        password=environment["MYSQL_ADMIN_PASSWORD"],
        autocommit=True,
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"CREATE DATABASE IF NOT EXISTS `{database}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
            cursor.execute(
                f"CREATE USER IF NOT EXISTS '{app_user}'@'%%' IDENTIFIED BY %s",
                (app_password,),
            )
            cursor.execute(
                f"ALTER USER '{app_user}'@'%%' IDENTIFIED BY %s",
                (app_password,),
            )
            cursor.execute(
                f"GRANT {SCHEMA_PRIVILEGES} ON `{database}`.* "
                f"TO '{app_user}'@'%'"
            )
    finally:
        connection.close()


def main() -> None:
    bootstrap_database(os.environ)


if __name__ == "__main__":
    main()
