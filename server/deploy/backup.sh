#!/bin/sh
set -eu

backup_dir=/opt/nosub/backups
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary="$backup_dir/nosub-$timestamp.dump.tmp"
destination="$backup_dir/nosub-$timestamp.dump"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
docker exec nosub-db-1 pg_dump -U nosub -d nosub -Fc > "$temporary"
mv "$temporary" "$destination"
chmod 600 "$destination"
find "$backup_dir" -type f -name 'nosub-*.dump' -mtime +14 -delete
