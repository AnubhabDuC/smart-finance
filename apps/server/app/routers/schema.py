from fastapi import APIRouter

from ..db import Base

router = APIRouter()


def _stringify_default(value) -> str | None:
    if value is None:
        return None
    arg = getattr(value, "arg", None)
    if arg is not None:
        return str(arg)
    return str(value)


@router.get("")
async def get_schema():
    tables = []
    for name, table in sorted(Base.metadata.tables.items()):
        columns = []
        for column in table.columns:
            columns.append(
                {
                    "name": column.name,
                    "type": str(column.type),
                    "nullable": column.nullable,
                    "primary_key": column.primary_key,
                    "unique": column.unique,
                    "default": _stringify_default(column.default),
                    "server_default": _stringify_default(column.server_default),
                    "foreign_keys": [str(fk.column) for fk in column.foreign_keys],
                }
            )
        indexes = [
            {
                "name": index.name,
                "columns": [col.name for col in index.columns],
                "unique": index.unique,
            }
            for index in table.indexes
        ]
        tables.append(
            {
                "name": name,
                "columns": columns,
                "indexes": indexes,
            }
        )
    return {"tables": tables}
