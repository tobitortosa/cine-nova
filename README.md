# CineNova

Sistema de venta y gestión de entradas para un complejo de cine. Trabajo Práctico N.º 1 de Programación IV (UTN, 2026 C2).

**Aplicación en línea:** https://cine-nova-seven.vercel.app
**Código:** https://github.com/tobitortosa/cine-nova

### Cuentas de prueba

| Rol | Email | Contraseña | Para ver |
|---|---|---|---|
| Administrador | `admin@cinenova.app` | `admin1234` | Panel completo, reportes y log de actividad |
| Empleado | `empleado@cinenova.app` | `empleado1234` | Pantalla de validación de QR |
| Cliente | `cliente@cinenova.app` | `cliente1234` | Compra con puntos y $5.000 de crédito |
| Cliente mayor de 50 | `mayor@cinenova.app` | `mayor1234` | Cupón `PLATEA50` por edad |

También se puede comprar sin registrarse. Cupones disponibles: `BIENVENIDA` (20 %, primera compra), `PLATEA50` (25 %, mayores de 50), `JUBILADOS` (35 %, mayores de 65).

La aplicación cubre los tres frentes que pidió el cliente: el sitio público donde se compran entradas y productos del candy bar, el panel de administración que controla toda la operación, y la pantalla que usan los empleados para validar los códigos QR en la puerta de la sala y en el mostrador.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Angular 21 (standalone, zoneless, signals) |
| Estilos | SCSS con sistema de tokens propio |
| Backend | Supabase (PostgreSQL + PostgREST + GoTrue + Realtime) |
| Autenticación | Supabase Auth con JWT |
| Autorización | Row Level Security en PostgreSQL |
| PWA | `@angular/service-worker` |
| PDF y QR | jsPDF + qrcode |
| Escaneo | html5-qrcode |
| Excel | SheetJS |
| Deploy | Vercel |

## Arquitectura

```
src/app/
  core/          servicios singleton, guards y modelos
    models/      interfaces TypeScript de todo el dominio
    services/    acceso a datos y lógica de aplicación
    guards/      protección de rutas por rol
  shared/        piezas reutilizables sin conocimiento del negocio
    components/  estrellas, avisos, selector de fecha y hora, modales
    pipes/       duración, precio, restricción, butaca, tiempo relativo
  layout/        cáscaras de la aplicación (público, auth, admin)
  features/      una carpeta por dominio funcional
    home/ peliculas/ compra/ cuenta/ auth/ admin/ empleado/
```

La regla de dependencias es unidireccional: `features` consume `core` y `shared`, nunca al revés, y dos features no se importan entre sí. Eso evita ciclos y permite que cada pantalla se cargue de forma diferida sin arrastrar el resto.

### Carga diferida

Todas las rutas usan `loadComponent`, así que cada pantalla viaja en su propio chunk. El panel de administración, que es la parte más pesada, no se descarga nunca para un usuario que solo quiere comprar una entrada.

### Estado

El estado vive en signals. `AuthService` expone `sesion`, `perfil` y los derivados `estaLogueado`, `esAdmin` y `esEmpleado` como `computed`, de modo que cualquier componente que los lea se actualiza solo cuando cambian. Como la aplicación es *zoneless*, la detección de cambios la disparan exclusivamente los signals: no hay Zone.js revisando el árbol completo ante cada evento.

`CarritoService` mantiene la compra en curso y persiste los productos en `localStorage` para que sobrevivan a la navegación entre pantallas.

## Decisiones técnicas

### La seguridad vive en la base de datos

La `publishable key` de Supabase viaja en el bundle del cliente, así que es pública por definición. Lo que impide que alguien la use para leer o borrar datos ajenos es **Row Level Security**: cada tabla tiene políticas que se evalúan contra el JWT de la sesión dentro de PostgreSQL.

Los guards de Angular no son una medida de seguridad sino de experiencia de usuario: evitan que alguien navegue a una pantalla que no le corresponde. Aunque se los saltee manipulando el cliente, la base no le devuelve un solo registro que no le pertenezca.

### Las reglas de negocio están en PostgreSQL, no en el frontend

Las reglas que no pueden fallar nunca se implementaron como restricciones y funciones de la base:

**Media hora entre funciones y cero solapamientos.** Cada función calcula su ventana de ocupación —desde que empieza hasta treinta minutos después de terminar— y una restricción `EXCLUDE` con `btree_gist` impide que dos funciones de la misma sala se superpongan:

```sql
constraint funciones_sin_solape
  exclude using gist (sala_id with =, ocupacion with &&)
```

La ventana se mantiene con un trigger `BEFORE INSERT OR UPDATE` en lugar de una columna generada, porque `timestamptz + interval` es `STABLE` y no `IMMUTABLE`, y PostgreSQL exige inmutabilidad para almacenar una columna calculada.

**Una butaca no se vende dos veces.** Un índice único parcial sobre `(funcion_id, butaca_id) where activa` resuelve la condición de carrera: si dos personas confirman la misma butaca en el mismo instante, la segunda transacción falla. Al cancelar, la entrada se marca `activa = false` y la butaca se libera sin perder el histórico.

**Asignación automática de sala.** La función `crear_funcion()` recibe película y horario, calcula el fin con la duración, busca la primera sala sin conflicto y la inserta. El administrador nunca elige sala, tal como pidió el cliente.

**La compra es atómica.** `registrar_compra()` valida la edad contra la restricción de la película, calcula precios distinguiendo butaca estándar, VIP y preventa, aplica el cupón, descuenta el crédito, inserta entradas y productos, acumula puntos y libera las reservas temporales. Todo en una sola transacción: o se hace completo o no se hace nada.

### Disponibilidad de butacas en tiempo real

Cuando un usuario abre el mapa de una función, el componente se suscribe por Supabase Realtime a los cambios de `entradas` y `reservas`. Mientras selecciona butacas, el sistema inserta reservas temporales con vencimiento de ocho minutos asociadas a un identificador de sesión guardado en `localStorage`. Los demás usuarios ven esas butacas como ocupadas al instante, y si alguien abandona la compra las reservas vencen solas.

### El QR es uno solo, con dos estados de consumo

El cliente pidió un único QR que sirviera para entrar a la sala y para retirar el candy bar, y también que dejara de funcionar una vez validado. Tomados literalmente los dos pedidos se contradicen. Se resolvió con un código único por compra y dos banderas de consumo independientes: `entrada_validada` y `productos_entregados`. Cada concepto se valida una sola vez.

### Un solo cliente de Supabase

`SupabaseService` está provisto en `root`, así que Angular crea una única instancia y la comparte con toda la aplicación. Eso garantiza que la sesión, el refresco del token y las suscripciones de Realtime sean consistentes en todas las pantallas.

### Selector de fecha y hora propio

El cliente pidió explícitamente no usar controles que obliguen a hacer scroll para elegir una fecha. `SelectorFechaHoraComponent` es un calendario mensual en grilla con selección de hora y minutos por botones, sin listas desplegables largas.

## Base de datos

Los scripts están en `supabase/` y se ejecutan en orden:

| Archivo | Contenido |
|---|---|
| `01_schema.sql` | Tipos, tablas, índices y triggers |
| `02_rpc.sql` | Funciones de negocio |
| `03_rls.sql` | Row Level Security, políticas y permisos |
| `04_seed.sql` | Datos de prueba |

Cada script es idempotente: se puede volver a ejecutar sin romper nada.

### Modelo de sala

Todas las salas comparten la distribución que definió el cliente: 20 filas de la A a la T, cada una con tres columnas de 4, 20 y 4 butacas.

| Tipo | Filas | Por fila | Total |
|---|---|---|---|
| Estándar | A a I y L a Q | 28 | 420 |
| VIP | R, S, T | 28 | 84 |
| Accesible | J, K | 14 | 28 |
| **Total** | **20 filas** | | **532** |

Dar de alta una sala genera sus 532 butacas automáticamente mediante un trigger.

## Puesta en marcha

```bash
npm install
npm start
```

La aplicación queda en `http://localhost:4200`.

Las credenciales de Supabase están en `src/environments/environment.ts`. Angular resuelve el entorno en tiempo de compilación sustituyendo el archivo según la configuración de build, por eso no se usa `.env`.

### Roles

El registro desde la aplicación crea siempre un usuario con rol `cliente`. Para promover a alguien, desde el SQL Editor de Supabase:

```sql
select promover('correo@ejemplo.com', 'admin');
select promover('correo@ejemplo.com', 'empleado');
```

## Deploy

```bash
npm run build
```

El build de producción activa el service worker y genera la salida en `dist/cine-nova/browser`. `vercel.json` ya tiene configurado el directorio de salida, la reescritura de rutas para que funcione el enrutamiento del lado del cliente, y las cabeceras de caché del service worker.
