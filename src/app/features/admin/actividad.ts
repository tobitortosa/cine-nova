import { LogActividad } from '../../core/models/modelos';

export type ColorAccion = 'ok' | 'peligro' | 'ambar' | 'neutro';

type Datos = Record<string, unknown>;

const ACCIONES: Record<string, string> = {
  crear: 'Creación',
  modificar: 'Modificación',
  actualizar: 'Modificación',
  modificar_precio: 'Cambio de precio',
  eliminar: 'Eliminación',
  cancelar: 'Cancelación',
  comprar: 'Compra',
  canjear: 'Canje',
  cambiar_rol: 'Cambio de rol',
  validar_qr: 'Validación QR',
};

const ENTIDADES: Record<string, string> = {
  peliculas: 'Película',
  funciones: 'Función',
  salas: 'Sala',
  productos: 'Producto',
  combos: 'Combo',
  categorias: 'Categoría',
  cupones: 'Cupón',
  recompensas: 'Recompensa',
  perfiles: 'Usuario',
  compra: 'Compra',
  compras: 'Compra',
};

const CAMPOS: Record<string, string> = {
  titulo: 'título',
  sinopsis: 'sinopsis',
  duracion_min: 'duración',
  imagen_url: 'imagen',
  banner_url: 'banner',
  restriccion_edad: 'restricción de edad',
  fecha_estreno: 'fecha de estreno',
  precio_preventa: 'preventa',
  en_cartelera: 'cartelera',
  destacada: 'destacada',
  nombre: 'nombre',
  descripcion: 'descripción',
  precio: 'precio',
  activo: 'activo',
  categoria_id: 'categoría',
  entradas_incluidas: 'entradas incluidas',
  inicio: 'horario',
  sala_id: 'sala',
  pelicula_id: 'película',
  formato: 'formato',
  idioma: 'idioma',
  precio_base: 'precio',
  precio_vip: 'precio VIP',
  codigo: 'código',
  porcentaje: 'porcentaje',
  tipo: 'tipo',
  edad_minima: 'edad mínima',
  producto_id: 'producto',
  costo_puntos: 'puntos',
  rol: 'rol',
  email: 'email',
  apellido: 'apellido',
  fecha_nacimiento: 'fecha de nacimiento',
};

const IGNORADOS = new Set(['id', 'fin', 'ocupacion', 'creado_en', 'creada_por', 'estreno_procesado']);

const ROLES: Record<string, string> = {
  cliente: 'cliente',
  empleado: 'empleado',
  admin: 'administrador',
};

const MONEDA = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function etiquetaAccion(accion: string): string {
  return ACCIONES[accion] ?? accion.replace(/_/g, ' ');
}

export function colorAccion(accion: string): ColorAccion {
  if (accion.includes('crear')) return 'ok';
  if (accion.includes('cancelar') || accion.includes('eliminar')) return 'peligro';
  if (accion.includes('validar')) return 'ambar';
  return 'neutro';
}

export function nombreEntidad(entidad: string): string {
  return ENTIDADES[entidad] ?? entidad.replace(/_/g, ' ');
}

export function resumenActividad(fila: LogActividad): string {
  const datos = esObjeto(fila.detalle) ? fila.detalle : {};

  switch (fila.accion) {
    case 'modificar_precio':
      return resumenPrecio(fila.entidad, datos);
    case 'cambiar_rol':
      return `${texto(datos['email'])}: ${rol(datos['rol_anterior'])} → ${rol(datos['rol_nuevo'])}`;
    case 'validar_qr':
      return `${datos['tipo'] === 'candy' ? 'Candy bar' : 'Entrada'} · código ${texto(datos['codigo'])}`;
    case 'cancelar':
      return `Compra ${texto(datos['codigo'])}`;
    case 'modificar':
    case 'actualizar':
      return resumenModificacion(fila.entidad, datos);
    default:
      return nombreDe(fila.entidad, datos);
  }
}

function resumenPrecio(entidad: string, datos: Datos): string {
  switch (entidad) {
    case 'funciones':
      return resumenPrecioFuncion(datos);
    case 'peliculas':
      return `${texto(datos['titulo'])}: ${preventa(datos['preventa_anterior'], datos['preventa_nuevo'])}`;
    case 'cupones':
      return `${texto(datos['codigo'])}: ${texto(datos['porcentaje_anterior'])}% → ${texto(datos['porcentaje_nuevo'])}%`;
    case 'recompensas':
      return `${texto(datos['nombre'])}: ${texto(datos['puntos_anterior'])} → ${texto(datos['puntos_nuevo'])} puntos`;
    default:
      return `${texto(datos['nombre'])}: ${moneda(datos['precio_anterior'])} → ${moneda(datos['precio_nuevo'])}`;
  }
}

function resumenPrecioFuncion(datos: Datos): string {
  const precio =
    `precio ${moneda(datos['precio_base_anterior'])} → ${moneda(datos['precio_base_nuevo'])}` +
    ` · VIP ${moneda(datos['precio_vip_anterior'])} → ${moneda(datos['precio_vip_nuevo'])}`;
  const antes = esObjeto(datos['antes']) ? datos['antes'] : null;
  const despues = esObjeto(datos['despues']) ? datos['despues'] : null;
  const nombre = despues ? nombreDe('funciones', despues) : '';

  if (!antes || !despues || !nombre) {
    return precio.charAt(0).toUpperCase() + precio.slice(1);
  }

  const otros = camposCambiados(antes, despues, ['precio_base', 'precio_vip']);
  const extra = otros.length > 0 ? ` · cambió ${otros.join(', ')}` : '';
  return `${nombre}: ${precio}${extra}`;
}

function resumenModificacion(entidad: string, datos: Datos): string {
  const antes = esObjeto(datos['antes']) ? datos['antes'] : {};
  const despues = esObjeto(datos['despues']) ? datos['despues'] : {};
  const nombre = nombreDe(entidad, despues);

  const unicos = camposCambiados(antes, despues);
  if (unicos.length === 0) {
    const cambioFin =
      entidad === 'funciones' && JSON.stringify(antes['fin'] ?? null) !== JSON.stringify(despues['fin'] ?? null);
    return cambioFin ? `${nombre}: cambió el horario de fin por la nueva duración de la película` : nombre;
  }

  const cambios = `cambió ${unicos.join(', ')}`;
  return nombre ? `${nombre}: ${cambios}` : cambios.charAt(0).toUpperCase() + cambios.slice(1);
}

function camposCambiados(antes: Datos, despues: Datos, excluidos: string[] = []): string[] {
  const campos = Array.from(new Set([...Object.keys(antes), ...Object.keys(despues)]))
    .filter((clave) => !IGNORADOS.has(clave) && !excluidos.includes(clave))
    .filter((clave) => JSON.stringify(antes[clave] ?? null) !== JSON.stringify(despues[clave] ?? null))
    .map((clave) => CAMPOS[clave] ?? clave.replace(/_/g, ' '));

  return Array.from(new Set(campos));
}

function nombreDe(entidad: string, datos: Datos): string {
  if (entidad === 'funciones' && typeof datos['inicio'] === 'string') {
    const momento = new Date(datos['inicio']);
    if (!Number.isNaN(momento.getTime())) {
      const fecha = momento.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      const hora = momento.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
      const formato = typeof datos['formato'] === 'string' ? ` · ${datos['formato']}` : '';
      return `Función del ${fecha} a las ${hora}${formato}`;
    }
  }

  const candidato = datos['titulo'] ?? datos['nombre'] ?? datos['codigo'] ?? datos['email'];
  return typeof candidato === 'string' || typeof candidato === 'number' ? String(candidato) : '';
}

function moneda(valor: unknown): string {
  const numero = Number(valor);
  return valor === null || valor === undefined || !Number.isFinite(numero) ? '—' : `$ ${MONEDA.format(numero)}`;
}

function preventa(anterior: unknown, nuevo: unknown): string {
  const sinAnterior = anterior === null || anterior === undefined;
  const sinNuevo = nuevo === null || nuevo === undefined;
  if (sinAnterior && sinNuevo) return 'sin preventa';
  if (sinAnterior) return `preventa nueva de ${moneda(nuevo)}`;
  if (sinNuevo) return `se quitó la preventa de ${moneda(anterior)}`;
  return `preventa ${moneda(anterior)} → ${moneda(nuevo)}`;
}

function rol(valor: unknown): string {
  const clave = texto(valor);
  return ROLES[clave] ?? clave;
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '—';
  return String(valor);
}

function esObjeto(valor: unknown): valor is Datos {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}
