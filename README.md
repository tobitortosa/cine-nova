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
| Cliente menor de 18 | `menor@cinenova.app` | `menor1234` | Compra de una película +13 con un adulto (16 años) |

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
| Backend | Supabase (PostgreSQL + PostgREST + GoTrue + Realtime + Storage) |
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
  shared/        piezas reutilizables entre pantallas
    components/  estrellas, avisos, campos de fecha y hora tipeados, modales
    directives/  solo dígitos, imagen de respaldo, zona de archivos, *appSiRol
    pipes/       duración, precio, restricción, butaca, medio de pago, tiempo relativo
    utils/       fechas, series semanales, reglas de venta y de edad
    validators/  validadores de tarjeta para Reactive Forms
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

**Asignación automática de sala.** La función `crear_funcion()` recibe película y horario, calcula el fin con la duración, busca la primera sala sin conflicto y la inserta. El administrador nunca elige sala, tal como pidió el cliente. También rechaza un horario que ya empezó o que es del pasado: el panel lo avisa antes de guardar, pero la regla está en la base para que no dependa del navegador.

**La compra es atómica.** `registrar_compra()` valida la edad contra la restricción de la película y la regla de menores, calcula precios distinguiendo butaca estándar, VIP y preventa, aplica los canjes y el cupón, descuenta el crédito, exige el medio de pago, inserta entradas y productos, acumula puntos y libera las reservas temporales. Todo en una sola transacción: o se hace completo o no se hace nada.

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

PostgreSQL manda los correos directamente a la API de Brevo con `pg_net`, sin servidor intermedio: la compra confirmada (con el código, el enlace al QR, cómo cancelarla y, si es de un menor, con qué adulto entra), el código para cancelar una compra de invitado, la cancelación con el crédito acreditado, la bienvenida con el cupón y la apertura de venta para las alertas. La clave de Brevo vive en la tabla `configuracion`, que tiene RLS activado y ninguna política: no la puede leer ni `anon` ni `authenticated`, solo las funciones `security definer`. Cada envío queda registrado en la tabla `correos`.

### Disponibilidad de butacas en tiempo real

Cuando un usuario abre el mapa de una función, el componente se suscribe por Supabase Realtime a los cambios de `entradas` y `reservas`. Mientras selecciona butacas, el sistema inserta reservas temporales con vencimiento de ocho minutos asociadas a un identificador de sesión guardado en `sessionStorage` (uno por pestaña). Los demás usuarios ven esas butacas como ocupadas al instante, y si alguien abandona la compra las reservas vencen solas.

Limitación conocida: las reservas son anónimas y el tope de 10 butacas es por sesión, así que un script con muchas sesiones podría mantener ocupada una sala. En un sistema real se resolvería con límites por IP en el gateway o exigiendo cuenta para reservar.

### El QR es uno solo, con dos estados de consumo

El cliente pidió un único QR que sirviera para entrar a la sala y para retirar el candy bar, y también que dejara de funcionar una vez validado. Tomados literalmente los dos pedidos se contradicen. Se resolvió con un código único por compra y dos banderas de consumo independientes: `entrada_validada` y `productos_entregados`. Cada concepto se valida una sola vez.

### Menores en películas +13: sumar o vincular al adulto

La consigna pide dos cosas: que quien no llega a la edad mínima no pueda comprar, y que toda entrada a esas películas aclare que tiene que ir un adulto. Con un aviso solo, nada garantizaba que ese adulto existiera, así que, a pedido de los profesores, la regla se hace cumplir:

- **+18:** solo mayores de 18, y en la puerta se pide DNI.
- **+13:** de 13 a 17 se puede comprar, pero el adulto tiene que tener su propia entrada para la misma función. Hay dos formas:
  1. **Sumar al adulto:** su butaca va en la misma compra, así que hacen falta 2 butacas o más.
  2. **Vincular su compra:** si el adulto ya compró, se ingresa el código de su compra. `verificar_adulto()` comprueba que exista, que sea de la misma función, que no esté cancelada, que tenga entradas activas y que quien la hizo sea mayor de edad. Devuelve solo `{ ok, motivo }`, sin datos de la compra ajena.
- Quien no llega a la edad mínima no puede comprar, ni siquiera sumando a un adulto.

La edad sale de la fecha de nacimiento del perfil o, si compra como invitado, de la que se pide al pagar. La regla se valida en los dos lados:

- **En el front**, el paso de pago muestra "¿Con quién venís?" y no deja pagar sin elegir una de las dos opciones. El código del adulto se verifica antes del pago.
- **En la base**, `registrar_compra()` recibe el código en `p_adulto_codigo`, vuelve a calcular la edad y verifica el código con la misma función interna que usa `verificar_adulto()`. Si falta el adulto, rechaza la compra aunque alguien se saltee el front.

La compra queda marcada con `requiere_adulto`, `adulto_codigo` y `comprador_mayor`. El comprobante y el PDF muestran la marca "Menor" y con qué adulto entra, el correo de la compra lo aclara y Mis compras lo señala con un chip.

En la puerta, `validar_qr()` no marca la entrada de una compra de menor en el primer escaneo. Devuelve `requiere_confirmacion` junto con el estado de la compra del adulto: si está vigente o cancelada, y si ya entró. El empleado ve "VERIFICÁ AL ADULTO" y elige:

- **"El adulto está presente":** se vuelve a llamar a `validar_qr()` con `p_adulto_presente = true`, que marca la entrada y deja en el log de actividad "con adulto verificado".
- **"No vino con un adulto":** se rechaza y la entrada no se consume.

El retiro del candy bar no pide esta confirmación.

### Un solo cliente de Supabase

`SupabaseService` está provisto en `root`, así que Angular crea una única instancia y la comparte con toda la aplicación. Eso garantiza que la sesión, el refresco del token y las suscripciones de Realtime sean consistentes en todas las pantallas.

### Imágenes con Supabase Storage

El administrador sube el póster, el banner y las fotos del candy bar desde el formulario, eligiendo el archivo o arrastrándolo, y ve la vista previa antes de guardar. Se sigue pudiendo pegar una URL. Todas las imágenes viven en el bucket, también las de ejemplo: `public/` ya no tiene pósters ni fotos del candy.

- **Un bucket público, `imagenes`** (`08_storage.sql`), con las carpetas `posters/`, `banners/`, `productos/` y `combos/`, un tope de 2 MB y solo JPG, PNG o WEBP. Las imágenes se ven en la cartelera sin iniciar sesión, así que leerlas por su URL pública no pasa por las políticas.
- **Subir y borrar, solo el admin.** En la clase, las políticas de `storage.objects` eran `to anon, authenticated` para insert, select y delete. Como la key pública viaja en el bundle, con esas políticas cualquier visitante podría subir o borrar archivos. Acá insert y delete son `to authenticated` y exigen `public.es_admin()`, la misma función que protege las tablas, y el insert además exige una de las cuatro carpetas y una extensión de imagen. El select también es solo para el admin: el bucket público ya sirve las URLs, y sin select para `anon` nadie puede listar el bucket. No hay política de update, porque una imagen nunca se pisa: se sube otra.
- **Tres controles:** `ImagenesService.validar()` y `appZonaArchivos` en el navegador, el tamaño y los tipos permitidos del bucket, y la política.
- **Nombres únicos.** Cada archivo se sube como `carpeta/<crypto.randomUUID()>.<ext>`, porque el nombre original puede traer espacios o tildes. Se sube con `upsert: false` y caché de un año, ya que una ruta nunca cambia de contenido.
- **El mismo cliente.** `ImagenesService` usa el cliente de `SupabaseService`, el que tiene la sesión, porque la política llama a `es_admin()`, que mira `auth.uid()`.

El orden de las operaciones evita que una fila quede apuntando a un archivo que no existe:

1. **Subir:** al tocar Guardar se sube el archivo y `getPublicUrl()` devuelve su URL.
2. **Guardar:** esa URL va a `imagen_url` o `banner_url` con el mismo insert o update de siempre, y el log de actividad registra "cambió imagen".
3. **Borrar la vieja:** recién cuando la fila se guardó, `borrarSiNoSeUsa()` borra la imagen anterior, y solo si es del bucket propio y ninguna película, producto o combo la usa. Si el guardado falla, se borra lo que se subió en ese intento.

Al eliminar un registro el orden es el mismo: primero la fila y después la imagen. La baja puede fallar (una película con ventas, un producto con canjes), y en ese caso la imagen tiene que seguir estando.

El service worker cachea las imágenes del bucket con el `dataGroup` `imagenes` de `ngsw-config.json`: hasta 120 imágenes (las 44 de ejemplo y las que suba el admin) durante 30 días. Lleva `cacheOpaqueResponses: true` porque un `<img>` de otro dominio siempre recibe una respuesta opaca, y sin esa opción el grupo no cachearía nada. Usa la estrategia `freshness`: primero va a la red y recurre a la copia guardada si no hay conexión o si tarda más de 5 segundos. Como la respuesta es opaca, el service worker no puede distinguir una imagen de un error 404. Con `performance`, un error guardado mientras una imagen todavía no estaba subida se seguiría mostrando durante 30 días.

#### Las imágenes de ejemplo

Los pósters, los banners y las fotos del candy bar de los datos de prueba están en `supabase/imagenes/`, ordenados igual que en el bucket: `posters/<slug>.jpg` (500×750), `banners/<slug>.jpg` (1920×820), `productos/<slug>.jpg` (600×600) y `combos/<slug>.jpg` (900×600). El slug sale del título o del nombre sin tildes, en minúsculas y con guiones ("El Jardín de Invierno" → `el-jardin-de-invierno`), con la misma expresión que usa `04_seed.sql`.

- **`scripts/subir-imagenes-seed.mjs`** sube esa carpeta al bucket con la cuenta de un administrador, porque las políticas solo le dejan subir a un admin. Lee la URL y la key pública de `src/environments/environment.ts`, y el email y la contraseña de las variables de entorno `CINENOVA_ADMIN_EMAIL` y `CINENOVA_ADMIN_PASSWORD` (no hay credenciales escritas en el código). Sube cada archivo en la misma ruta con `upsert: false` y caché de un año. Si un archivo ya estaba, lo cuenta como "ya estaba" y sigue, así que se puede correr las veces que haga falta. Al final muestra cuántas imágenes subió, cuántas ya estaban y cuántas fallaron, y si alguna falló termina con error. Al terminar cierra solo la sesión que abrió (`scope: 'local'`), así que no desloguea a quien tenga el panel abierto con la misma cuenta. Con `--simular` lista lo que subiría sin conectarse a nada.
- **`04_seed.sql`** carga cada película, producto y combo de ejemplo con la URL pública del bucket. Las imágenes van en el mismo insert, así que volver a correrlo no pisa la imagen de nada que ya exista.

Las imágenes de ejemplo se tratan como cualquier otra: si el admin le cambia el póster a una película de ejemplo, la imagen anterior se borra del bucket. El original sigue en `supabase/imagenes/` y el script lo vuelve a subir.

#### Imagen por defecto

La consigna dice que toda película tiene una imagen. Al guardar una película, un producto o un combo, sea un alta o una edición, si falta una imagen (póster, banner o foto) y no se eligió archivo ni URL, `GeneradorImagenesService` la dibuja en el navegador con Canvas, con el mismo estilo que las imágenes de ejemplo: fondo oscuro teñido de un color de acento, círculos finos, un corte diagonal, el género o la categoría arriba y el título o el nombre abajo. En el formulario se ve antes de guardar, con el sello "Automática", y se reemplaza subiendo una imagen o pegando una URL. Al guardar se sube al bucket como si el admin la hubiera elegido. Si la generación o la subida fallan, se avisa y el registro queda sin esa imagen, que se puede agregar después desde Editar.

### Fechas y horas que se escriben, sin calendario

En el mail del 28/02 el cliente pidió "una mejor forma de ingresar fechas y horas que no implique tanto tiempo de búsqueda", porque "demasiado scroll nos hace doler la cabeza". La primera versión usaba calendarios propios en grilla, y los profesores pidieron reemplazarlos en la corrección: un calendario clickeable sigue obligando a buscar el día en una grilla y a pasar mes por mes, o año por año en una fecha de nacimiento. Por eso en la aplicación no queda ningún calendario: todas las fechas y horas se escriben.

- **`app-campo-fecha`:** tres casillas para DD, MM y AAAA que pasan solas a la siguiente y aceptan pegar la fecha entera. Debajo se lee el resultado en texto, por ejemplo "Lunes 12 de octubre de 2026", la edad si es una fecha de nacimiento, o el motivo del error. Para no tipear lo más común tiene atajos como "Hoy", "Mañana" o "+7 días".
- **`app-campo-hora`:** HH:MM, con horarios sugeridos.
- **`app-campo-fecha-hora`:** los dos juntos para el horario de una función, con un mínimo para que no se pueda elegir un momento que ya pasó.

Los campos de fecha y de hora implementan `ControlValueAccessor`, así que se conectan con `formControlName` como cualquier input. Reactive Forms recibe el mismo texto que con los calendarios (`AAAA-MM-DD` o `HH:mm`), por eso los formularios, los servicios y la base no cambiaron. El de fecha además implementa `Validator` (registrado con `NG_VALIDATORS`): una fecha imposible como 31/02 devuelve el error `fechaInvalida` con el motivo, en lugar de guardarse como "sin fecha". Fuera de un formulario se usan con `[valor]` y `(valorChange)`, porque `valor` es un `model()`.

Se usan en los filtros y el alta de funciones, los reportes, la fecha de estreno de una película y la fecha de nacimiento en el registro, el perfil y la compra.

Para cargar "lunes, martes y viernes a las 18 hs" está la serie semanal: se marcan los días, se escribe la hora y se elige cuántas semanas. Antes de guardar se ve la lista exacta de funciones que se van a crear ("lun 12/10 18:00…"). La calcula `shared/utils/series.ts`, la misma función que usa el servicio para crearlas, así que lo que se ve es lo que se guarda. Cada función pasa por `crear_funcion()`, que le asigna sala y rechaza los horarios que ya pasaron.

### Directivas propias

Están en `shared/directives`, son standalone y cada componente importa solo las que usa.

| Directiva | Tipo | Qué hace | Dónde se usa |
|---|---|---|---|
| `appSoloDigitos` | De atributo | Deja escribir y pegar solo números: frena el carácter en el `beforeinput`, antes de que aparezca, y vuelve a limpiar el valor antes de que lo lea Reactive Forms. Respeta `maxlength` y pone `inputmode="numeric"` para que el celular abra el teclado numérico | Casillas de los campos de fecha y hora, y código de 6 dígitos para cancelar una compra de invitado |
| `appImagenRespaldo` | De atributo | Si un `<img>` no carga, lo reemplaza por `/sin-imagen.svg` (o la imagen que se le pase) sin entrar en bucle y le agrega la clase `imagen-respaldo` | Todas las imágenes de películas y del candy bar: home, cartelera, próximamente, detalle, compra, candy, Mis compras, Mis películas y los paneles del admin |
| `appZonaArchivos` | De atributo | Convierte un elemento en una zona para arrastrar y soltar archivos: evita que el navegador abra el archivo, pone la clase `arrastrando`, filtra por tipo y tamaño, y emite `(archivos)` o `(rechazo)` con el motivo | Póster y banner en el admin de películas, imágenes de productos y combos en el admin del candy bar |
| `*appSiRol` | Estructural | Muestra su contenido solo si el rol del usuario está entre los que recibe, por ejemplo `*appSiRol="['empleado', 'admin']"`. Lee el signal `perfil()` de `AuthService` en un `computed`, y un `effect` crea o destruye la vista con `TemplateRef` y `ViewContainerRef`, así que se actualiza sola al iniciar o cerrar sesión | Menú de usuario del header: "Validar entradas" para empleados y admins, "Panel de administración" solo para admins |

Las de atributo cambian el comportamiento del elemento donde se ponen; la estructural decide si el elemento existe, como `@if`, pero con la regla de roles en un solo lugar. Igual que los guards, `*appSiRol` es experiencia de usuario y no seguridad: la seguridad sigue estando en RLS.

### Pipes

Todos son puros (el valor por defecto): Angular solo los vuelve a calcular cuando cambia el valor de entrada.

| Pipe | Ejemplo | Dónde se usa |
|---|---|---|
| `precio` | `12500` → `$ 12.500` | Precios, totales y reportes |
| `duracion` | `135` → `2 h 15 min` | Home, cartelera, próximamente, detalle, compra y admin |
| `restriccion` | `13` → `+13`, `0` → `ATP` | Chips de edad. Delega en `etiquetaRestriccion()` de `shared/utils/restriccion.ts`, la misma función que usan el PDF y el validador |
| `butaca` | fila `F`, número `7` → `F7` | Butacas elegidas en la compra |
| `medioPago` | `'largo'`: "Tarjeta de crédito Visa terminada en 4242"; `'corto'`: "Visa •••• 4242" | Mis compras y comprobante (el PDF usa la misma función) |
| `desde` | una fecha → "hace 5 minutos" | Actividad reciente del dashboard y reseñas |

## Base de datos

Los scripts están en `supabase/` y se ejecutan en orden:

| Archivo | Contenido |
|---|---|
| `01_schema.sql` | Tipos, tablas, índices y los triggers que cuidan los datos: butacas de cada sala, horarios sin superponer, funciones con ventas o del pasado, estrenos, duración de las películas, productos con canjes y reseñas |
| `02_rpc.sql` | Funciones de negocio: alta de funciones, reserva y compra de butacas, regla de menores, cancelación de compras (también las de invitado, con código por correo), validación del QR, canjes, reseñas, reportes y `promover()` |
| `03_rls.sql` | Row Level Security, políticas y permisos de las tablas y de las funciones del `01` y el `02` |
| `04_seed.sql` | Datos de prueba |
| `05_auditoria.sql` | Log de actividad por triggers |
| `06_usuarios_demo.sql` | Cuentas de prueba, incluida `menor@cinenova.app` |
| `07_correos.sql` | Correos (tablas, plantillas, envío por Brevo y sus permisos) y apertura automática de ventas |
| `08_storage.sql` | Bucket `imagenes` de Supabase Storage y sus políticas: subir, listar y borrar solo el admin |

Cada función, trigger y permiso está en un solo archivo y en su versión final: ningún script reemplaza lo que crea otro.

El orden completo es:

1. Del `01` al `08`. El `08` crea el bucket.
2. Subir las imágenes de ejemplo, desde la carpeta del proyecto y con las dependencias instaladas (`npm install`):
   ```bash
   CINENOVA_ADMIN_EMAIL=... CINENOVA_ADMIN_PASSWORD=... node scripts/subir-imagenes-seed.mjs
   ```
   En PowerShell: `$env:CINENOVA_ADMIN_EMAIL='...'; $env:CINENOVA_ADMIN_PASSWORD='...'; node scripts/subir-imagenes-seed.mjs`. La cuenta tiene que ser de administrador. En un proyecto nuevo sirve `admin@cinenova.app`, que crea el `06`. Con `--simular` se ve qué subiría sin conectarse.

Cada script es idempotente: se puede volver a ejecutar, solo o junto con los demás, sin romper nada y sin duplicar datos. Conviene correrlos sin usuarios en la app; si alguno se corta por un interbloqueo, se vuelve a correr.

El `04` tiene escrita la URL pública del bucket de este proyecto, igual que `environment.ts`, `ngsw-config.json` y `url_app` en la tabla `configuracion`. Para usar otro proyecto de Supabase hay que cambiarla en todos esos lugares.

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
