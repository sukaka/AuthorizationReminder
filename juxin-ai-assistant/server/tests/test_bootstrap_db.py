from unittest.mock import MagicMock

import pytest

from scripts.bootstrap_db import bootstrap_database, validate_identifier


def test_validate_identifier_rejects_sql_fragments() -> None:
    assert validate_identifier("juxin_ai_assistant") == "juxin_ai_assistant"

    for value in ("bad-name", "db;DROP DATABASE mysql", "user'@'localhost"):
        with pytest.raises(ValueError, match="格式无效"):
            validate_identifier(value)


def test_bootstrap_uses_schema_scoped_privileges_and_parameterized_password() -> None:
    cursor = MagicMock()
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor
    connector = MagicMock(return_value=connection)
    environment = {
        "MYSQL_HOST": "mysql",
        "MYSQL_PORT": "3306",
        "MYSQL_ADMIN_USER": "root",
        "MYSQL_ADMIN_PASSWORD": "root-secret",
        "MYSQL_DATABASE": "juxin_ai_assistant",
        "MYSQL_USER": "ai_assistant_user",
        "MYSQL_PASSWORD": "app-secret",
    }

    bootstrap_database(environment, connect=connector)

    connector.assert_called_once_with(
        host="mysql",
        port=3306,
        user="root",
        password="root-secret",
        autocommit=True,
    )
    statements = [call.args[0] for call in cursor.execute.call_args_list]
    assert all("root-secret" not in statement for statement in statements)
    assert all("app-secret" not in statement for statement in statements)
    assert any("CREATE DATABASE IF NOT EXISTS `juxin_ai_assistant`" in statement for statement in statements)
    grant_statement = next(statement for statement in statements if statement.startswith("GRANT "))
    assert "ON `juxin_ai_assistant`.*" in grant_statement
    assert "ALL PRIVILEGES" not in grant_statement
    assert "GRANT OPTION" not in grant_statement
    assert "SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES" in grant_statement
    connection.close.assert_called_once_with()
