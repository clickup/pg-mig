@clickup/pg-mig / [Exports](modules.md)

# @clickup/pg-mig: PostgreSQL schema migration tool with micro-sharding and clustering support

See also [Full API documentation](https://github.com/clickup/pg-mig/blob/master/docs/modules.md).

![CI run](https://github.com/clickup/pg-mig/actions/workflows/ci.yml/badge.svg?branch=main)

The tool allows to create a PostgreSQL database schema (with tables, indexes,
sequences, functions etc.) and apply it consistently across multiple PG hosts
(even more, across multiple micro-shard schemas on multiple hosts). The behavior
is transactional per each micro-shard per version ("all or nothing").

In other words, **pg-mig** helps to keep your database clusters' schemas identical
(each micro-shard schema will have exactly the same DDL structure as any other
schema on all other PG hosts).

# Usage

```
pg-mig
  [--migdir=path/to/my-migrations/directory]
  [--hosts=master1,master2,...]
  [--port=5432]
  [--user=user-which-can-apply-ddl]
  [--pass=password]
  [--db=my-database-name]
  [--undo=20191107201239.my-migration-name.sh]
  [--make=my-migration-name@sh]
  [--parallelism=8]
  [--dry]
  [--list]
  [--ci]
```

All of the arguments are optional: the tool tries to use `PGHOST`, `PGPORT`,
`PGUSER`, `PGPASSWORD`, `PGDATABASE` environment variables which are standard
for e.g. `psql`. 

It also uses `PGMIGDIR` environment variable as a default value for `--migdir`
option.

When running in default mode, **pg-mig** tool reads (in order) the migration
versions `*.up.sql` files from the migration directory and applies them all of
the hostnames passed (of course, checking whether it has already been applied
before or not). See below for more details.

## Migration Version File Format

The migration version file name has the following format, examples:

```
20191107201239.add-table-abc.sh0000.up.sql
20191107201239.add-table-abc.sh0000.dn.sql
20231317204837.some-other-name.sh.up.sql
20231317204837.some-other-name.sh.dn.sql
20231203493744.anything-works.public.up.sql
20231203493744.anything-works.public.dn.sql
```

Here,

- the 1st part is a UTC timestamp when the migration version file was created,
- the 2nd part is a descriptive name of the migration (can be arbitrary),
- the 3rd part is the "PostgreSQL schema name prefix" (micro-shard name prefix)
- the 4th part is either "up" ("up" migration) or "dn" ("down" migration).
  Up-migrations roll the database schema version forward, and down-migrations
  allow to undo the changes.

It is the responsibility of the user to create up- and down-migration SQL files.
Basically, the user provides DDL SQL queries on how to roll the database schema
forward and how to roll it backward.

You can use any `psql`-specific instructions in `*.sql` files: they are fed to
`psql` tool directly. E.g. you can use environment variables, `\echo`, `\ir` for
inclusion etc. See [psql
documentation](https://www.postgresql.org/docs/current/app-psql.html) for
details.

## Applying the Migrations

Each migration version will be applied (in order) to all PG schemas (aka
micro-shards) on all hosts whose names start from the provided prefix (if
multiple migration files match some schema, then only the file with the longest
prefix will be used; in the above example, prefix "sh" effectively works as "sh*
except sh0000" wildcard).

The main idea is that, if the migration file application succeeds, then it will
be remembered on the corresponding PG host, in the corresponding schema
(micro-shard) itself. So next time when you run the tool, it will understand
that the migration version has already been applied, and won't try to apply it
again.

When the tool runs, it prints a live-updating progress, which migration version
file is in progress on which PG host in which schema (micro-shard). In the end,
it prints the final versions map across all of the hosts and schemas.

## Undoing the Migrations

If `--undo` argument is used, then the tool will try to run the down-migration
for the the corresponding version everywhere. If it succeeds, then it will
remember that fact on the corresponding PG host in the corresponding schema.
Only the very latest migration version applied can be undone.

Undoing migrations in production is not recommended (since the code which uses
the database may rely on its new structure), although you can use it of course.
The main use case for undoing the migrations is while development: you may want
to test your DDL statements multiple times, or you may pull from Git and get
someone else's migration before yours, so you'll need to undo your migration and
recreate its files.

## Creating the New Migration Files

If `--make` argument is used, **pg-mig** creates a new pair of empty files in the
migration directory. E.g. if you run:

```
pg-mig --migdir=my-dir --make=my-migration-name@sh
```

then it will create a pair of files which looks like
`my-dir/20231203493744.my-migration-name.sh.up.sql` and
`my-dir/20231203493744.my-migration-name.sh.dn.sql` which you can edit further.

New migration version files can only be appended in the end. If **pg-mig** detects
that you try to apply migrations which conflict with the existing migration
versions remembered in the database, it will print the error and refuse to
continue. This is similar to "fast-forward" mode in Git.
