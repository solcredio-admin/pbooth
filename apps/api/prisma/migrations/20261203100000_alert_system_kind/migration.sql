-- existing alert chats also get the new "SYSTEM" kind (backups, photo processing, storage)
UPDATE "AlertChat" SET "kinds" = array_append("kinds", 'SYSTEM') WHERE NOT ('SYSTEM' = ANY("kinds"));
