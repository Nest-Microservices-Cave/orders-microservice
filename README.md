# Orders Microservice

## Dev

1. Clonar el repositorio
2. Instalar dependencias
3. Crear un archivo `.env` basado en el `.env.template`
4. Levantar la base de datos

```
pnpm compose:up
```

5. Ejecutar migración de prisma `pnpx prisma migrate dev`
6. Ejecutar `pnpm start:dev`

Bajar la base de datos

```
pnpm compose:down
```
