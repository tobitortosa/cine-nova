export type RolUsuario = 'cliente' | 'empleado' | 'admin';
export type TipoButaca = 'estandar' | 'vip' | 'accesible';
export type FormatoFuncion = '2D' | '3D' | '4D' | '5D';
export type IdiomaFuncion = 'castellano' | 'subtitulada';
export type EstadoCompra = 'pagada' | 'cancelada';
export type TipoCupon = 'bienvenida' | 'edad';
export type TipoRecompensa = 'entrada' | 'producto';
export type MedioPago = 'tarjeta_credito' | 'tarjeta_debito' | 'mercado_pago' | 'sin_cargo';

export interface Perfil {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  fecha_nacimiento: string | null;
  tipo_sangre: string | null;
  color_ojos: string | null;
  dias_vacaciones: number | null;
  rol: RolUsuario;
  puntos: number;
  credito: number;
  cupon_bienvenida_usado: boolean;
  creado_en: string;
}

export interface Genero {
  id: number;
  nombre: string;
}

export interface Pelicula {
  id: number;
  titulo: string;
  sinopsis: string;
  duracion_min: number;
  imagen_url: string | null;
  banner_url: string | null;
  restriccion_edad: number;
  fecha_estreno: string | null;
  precio_preventa: number | null;
  en_cartelera: boolean;
  destacada: boolean;
  creado_en: string;
  generos?: Genero[];
  promedio?: number;
  total_resenias?: number;
}

export interface Sala {
  id: number;
  nombre: string;
}

export interface Butaca {
  id: number;
  sala_id: number;
  fila: string;
  numero: number;
  columna: number;
  tipo: TipoButaca;
}

export interface Funcion {
  id: number;
  pelicula_id: number;
  sala_id: number;
  inicio: string;
  fin: string;
  formato: FormatoFuncion;
  idioma: IdiomaFuncion;
  precio_base: number;
  precio_vip: number;
  creada_por: string | null;
  creado_en: string;
  pelicula?: Pelicula;
  sala?: Sala;
}

export interface Categoria {
  id: number;
  nombre: string;
}

export interface Producto {
  id: number;
  categoria_id: number | null;
  nombre: string;
  descripcion: string;
  precio: number;
  imagen_url: string | null;
  activo: boolean;
  categoria?: Categoria;
}

export interface Combo {
  id: number;
  nombre: string;
  descripcion: string;
  precio: number;
  imagen_url: string | null;
  activo: boolean;
  entradas_incluidas?: number;
}

export interface Cupon {
  id: number;
  codigo: string;
  descripcion: string;
  porcentaje: number;
  tipo: TipoCupon;
  edad_minima: number | null;
  activo: boolean;
}

export interface Recompensa {
  id: number;
  nombre: string;
  tipo: TipoRecompensa;
  producto_id: number | null;
  costo_puntos: number;
  activo: boolean;
}

export interface Compra {
  id: number;
  usuario_id: string | null;
  email_contacto: string;
  codigo: string;
  funcion_id: number | null;
  subtotal: number;
  descuento: number;
  credito_usado: number;
  total: number;
  puntos_ganados: number;
  cupon_id: number | null;
  estado: EstadoCompra;
  entrada_validada: boolean;
  entrada_validada_en: string | null;
  productos_entregados: boolean;
  productos_entregados_en: string | null;
  medio_pago: MedioPago | null;
  tarjeta_marca: string | null;
  tarjeta_ultimos4: string | null;
  descuento_canjes: number;
  descuento_combos?: number;
  creado_en: string;
  funcion?: Funcion;
}

export interface Entrada {
  id: number;
  compra_id: number;
  funcion_id: number;
  butaca_id: number;
  precio: number;
  activa: boolean;
  butaca?: Butaca;
}

export interface CompraItem {
  id: number;
  compra_id: number;
  producto_id: number | null;
  combo_id: number | null;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  entregado: boolean;
}

export interface Resenia {
  id: number;
  pelicula_id: number;
  usuario_id: string;
  estrellas: number;
  comentario: string;
  creado_en: string;
  autor?: string;
}

export interface Canje {
  id: number;
  usuario_id: string;
  recompensa_id: number | null;
  nombre: string;
  puntos_gastados: number;
  codigo: string;
  tipo: TipoRecompensa | null;
  producto_id: number | null;
  usado: boolean;
  usado_en: string | null;
  compra_id: number | null;
  creado_en: string;
}

export interface DatosPago {
  medio: MedioPago;
  marca?: string | null;
  ultimos4?: string | null;
}

export interface AlertaEstreno {
  id: number;
  usuario_id: string;
  pelicula_id: number;
  notificada: boolean;
  creado_en: string;
}

export interface LogActividad {
  id: number;
  usuario_id: string | null;
  email: string | null;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  detalle: Record<string, unknown> | null;
  creado_en: string;
}

export interface EstadoButaca {
  butaca_id: number;
  estado: 'vendida' | 'reservada';
}

export interface ItemCarrito {
  producto_id: number | null;
  combo_id: number | null;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  imagen_url: string | null;
}

export interface DatosRegistro {
  email: string;
  password: string;
  nombre: string;
  apellido: string;
  fecha_nacimiento: string;
  tipo_sangre: string;
  color_ojos: string;
  dias_vacaciones: number;
}

export interface ButacaComprada {
  etiqueta: string;
  tipo: TipoButaca;
}

export interface ResumenCompra {
  compra: Compra;
  pelicula: Pelicula | null;
  funcion: Funcion | null;
  sala: string | null;
  butacas: ButacaComprada[];
  items: { nombre: string; cantidad: number; precio_unitario: number }[];
}

export interface ResultadoValidacion {
  ok: boolean;
  motivo?: string;
  codigo?: string;
  pelicula?: string;
  inicio?: string;
  sala?: string;
  butacas?: string[];
  items?: { nombre: string; cantidad: number }[];
}

export interface PeliculaVendida {
  pelicula_id: number;
  titulo: string;
  imagen_url: string | null;
  vendidas: number;
}

export interface FilaFacturacion {
  dia: string;
  compras: number;
  entradas: number;
  productos: number;
  facturado: number;
}

export interface TopProducto {
  nombre: string;
  unidades: number;
  facturado: number;
}

export interface PeliculaVista {
  periodo: string;
  titulo: string;
  vistas: number;
}

export interface EstadisticasAdmin {
  facturado_hoy: number;
  entradas_hoy: number;
  facturado_mes: number;
  usuarios: number;
  peliculas: number;
  funciones_hoy: number;
}

export interface MiPelicula {
  pelicula_id: number;
  titulo: string;
  imagen_url: string | null;
  vista_en: string;
  estrellas: number | null;
}
