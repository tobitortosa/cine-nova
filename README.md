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

### Tarjetas de prueba

El pago es simulado: no se procesa ningún cobro real. La pasarela simulada responde según el número de tarjeta, con cualquier vencimiento futuro y cualquier CVV.

| Número | Marca | Resultado |
|---|---|---|
| `4242 4242 4242 4242` | Visa | Aprobada |
| `5555 5555 5555 4444` | Mastercard | Aprobada |
| `3782 822463 10005` | American Express | Aprobada (CVV de 4 dígitos) |
| `4000 0000 0000 0002` | Visa | Rechazada por el emisor |
| `4000 0000 0000 9995` | Visa | Sin fondos |

También se puede elegir Mercado Pago, que se aprueba siempre.

"Ciudad Reflejo" tiene la **preventa abierta**: se compra desde Próximamente a precio especial hasta el día anterior al estreno.

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

**La compra es atómica.** `registrar_compra()` valida la edad contra la restricción de la película, calcula precios distinguiendo butaca estándar, VIP y preventa, aplica los canjes y el cupón, descuenta el crédito, exige el medio de pago, inserta entradas y productos, acumula puntos y libera las reservas temporales. Todo en una sola transacción: o se hace completo o no se hace nada.

### El pago es simulado, pero la base no le cree al navegador

El flujo es el de un sitio real: se eligen butacas, se paga online y el QR que se recibe ya es la entrada paga. No hay una pasarela productiva, porque no la pidió el cliente ni la consigna; en su lugar, `PasarelaPagoService` simula una con tarjetas de prueba, demoras y rechazos. Como es un servicio inyectable, integrar Mercado Pago o cualquier otro proveedor sería reemplazar ese servicio sin tocar el componente.

Lo importante es que nada de lo que calcula el frontend se toma como cierto:

- **Los precios salen del catálogo.** El carrito se guarda en `localStorage`, que el usuario puede editar. Por eso `registrar_compra()` ignora el precio y el nombre que manda el cliente y los busca en `productos` y `combos`, exigiendo que estén activos.
- **El total se verifica.** El frontend manda el monto que cobró la pasarela y la base lo compara con el que calcula ella. Si difieren (por ejemplo porque el crédito ya se había usado en otra pestaña), la compra se rechaza en lugar de guardar un total distinto del cobrado.
- **Los datos de la tarjeta no se guardan.** El número completo y el CVV nunca salen del navegador. A la base solo llegan el medio, la marca y los últimos cuatro dígitos, con una restricción que valida que sean cuatro números.

Los validadores de tarjeta son validadores propios de Reactive Forms: algoritmo de Luhn, largo según la marca, vencimiento futuro, CVV de 3 o 4 dígitos según sea American Express (validador de grupo, porque depende de dos campos) y titular con nombre y apellido.

### Canje de puntos

Cada canje genera un código. En el paso de pago el usuario elige qué canjes aplicar: una entrada gratis descuenta el precio de una butaca estándar, y un producto se agrega al pedido a $0. La base verifica que el canje sea del usuario, que no se haya usado y que no haya más canjes de entrada que butacas, y lo bloquea con `select ... for update` para que no se pueda usar dos veces al mismo tiempo. Si la compra se cancela, el canje vuelve a quedar disponible.

### Cancelación con crédito, también para invitados

El cliente pidió que se pueda cancelar hasta 2 horas antes de la función y que no se devuelva dinero sino crédito en la cuenta, visible en el perfil. Quien compró con su cuenta cancela desde Mis compras. Quien compró como invitado también puede, pero como el crédito necesita una cuenta donde quedar, se la pedimos al cancelar y no al comprar:

1. En su entrada (`/compra/CODIGO`, a la que llega desde el correo de la compra) ve la sección "¿No vas a poder ir?".
2. Ingresa o crea una cuenta y vuelve a la entrada.
3. Pide un código de 6 dígitos, que le llega **al email de la compra**, y lo escribe.
4. La compra se vincula a esa cuenta y se cancela con la misma `cancelar_compra()` de siempre: 2 horas, entrada sin validar, candy sin retirar, crédito acreditado y butacas liberadas, en una sola transacción.

Lo que hay que probar es que quien cancela es el comprador, y ni el código de compra ni el email de la cuenta lo prueban. El código de compra es el QR: va en el PDF y se le pasa a los acompañantes. El email de la cuenta tampoco, porque el registro no lo verifica y cualquiera podría registrarse con un email ajeno. Por eso no vinculamos compras por email. Lo único que demuestra la titularidad es tener acceso a la casilla de la compra, igual que un "olvidé mi contraseña".

El código se guarda hasheado en `cancelaciones_invitado`, que tiene RLS activado y ninguna política, y no como columna de `compras`, porque `buscar_compra()` es pública. Vence a los 15 minutos (o antes, si se cierra el plazo de 2 horas), sirve una sola vez y solo para la cuenta que lo pidió, admite 5 intentos y como máximo se envían 5 por compra cada 24 horas. El correo del código dice qué cuenta lo pidió, así quien compró se entera si no lo pidió.

El crédito siempre termina en una cuenta: `cancelar_compra()` no anula una compra sin dueño, aunque lo pida un administrador, y las compras, entradas e ítems ya no se pueden modificar directamente por la API, ni siquiera con un usuario admin. Solo cambian a través de las funciones de la base, que son las que aplican las reglas.

El cliente de Supabase tampoco toma sesiones de la URL (`detectSessionInUrl: false`). La app no usa magic links ni OAuth, y así nadie puede mandar un enlace con su `#access_token` que deje a otra persona logueada en su cuenta para quedarse con el crédito que ella cancela.

### Preventa y apertura automática de la venta

`venta_abierta()` y `preventa_vigente()` deciden en la base si una película se puede vender y a qué precio. Si tiene precio de preventa, la venta se abre 7 días antes del estreno; si no, el día del estreno. `shared/utils/ventas.ts` replica exactamente esas reglas para mostrar los precios antes de pagar.

Un job de `pg_cron` corre cada hora: pasa a cartelera las películas que ya se estrenaron y avisa a quienes activaron la alerta de una película cuya venta acaba de abrir.

### Correos automáticos

PostgreSQL manda los correos directamente a la API de Brevo con `pg_net`, sin servidor intermedio: la compra confirmada (con el código, el enlace al QR y cómo cancelarla), el código para cancelar una compra de invitado, la cancelación con el crédito acreditado, la bienvenida con el cupón y la apertura de venta para las alertas. La clave de Brevo vive en la tabla `configuracion`, que tiene RLS activado y ninguna política: no la puede leer ni `anon` ni `authenticated`, solo las funciones `security definer`. Cada envío queda registrado en la tabla `correos`.

### Disponibilidad de butacas en tiempo real

Cuando un usuario abre el mapa de una función, el componente se suscribe por Supabase Realtime a los cambios de `entradas` y `reservas`. Mientras selecciona butacas, el sistema inserta reservas temporales con vencimiento de ocho minutos asociadas a un identificador de sesión guardado en `sessionStorage` (uno por pestaña). Los demás usuarios ven esas butacas como ocupadas al instante, y si alguien abandona la compra las reservas vencen solas.

Limitación conocida: las reservas son anónimas y el tope de 10 butacas es por sesión, así que un script con muchas sesiones podría mantener ocupada una sala. En un sistema real se resolvería con límites por IP en el gateway o exigiendo cuenta para reservar.

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
| `05_auditoria.sql` | Log de actividad por triggers |
| `06_usuarios_demo.sql` | Cuentas de prueba |
| `07_correos.sql` | Envío de correos y apertura automática de ventas |
| `08_correcciones.sql` | Correcciones: reservas con vencimiento fijo, combos con entradas, permisos, reseñas, reportes por día local y control de envíos de Brevo |
| `09_cancelacion_invitados.sql` | Cancelación de compras de invitado con código por correo, y compras que solo se modifican por funciones |

Cada script es idempotente: se puede volver a ejecutar sin romper nada. El 08 y el 09 reemplazan funciones, triggers y permisos de los anteriores, y el 09 también reemplaza funciones del 08: si se vuelve a correr cualquiera de los scripts 01 a 07, después hay que correr el 08 y el 09, en ese orden, y si se vuelve a correr el 08, también el 09. Conviene correrlos sin usuarios en la app; si alguno se corta por un interbloqueo, se vuelve a correr.

Para que los correos salgan hay que cargar una sola vez, desde el SQL Editor, la clave de la API de Brevo y una dirección de remitente verificada en Brevo:

```sql
update configuracion set valor = 'xkeysib-...' where clave = 'brevo_api_key';
update configuracion set valor = 'remitente@verificado.com' where clave = 'correo_remitente';
```

Cada hora el mismo job revisa la respuesta de Brevo: si rechazó un envío, el correo queda como `fallido` en la tabla `correos` con el detalle del error. Las alertas de estreno recién se marcan como avisadas cuando el correo se pudo encolar.

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
