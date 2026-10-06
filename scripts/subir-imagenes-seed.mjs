import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARPETA_IMAGENES = join(RAIZ, 'supabase', 'imagenes');
const ARCHIVO_ENTORNO = join(RAIZ, 'src', 'environments', 'environment.ts');
const BUCKET = 'imagenes';
const CARPETAS = ['posters', 'banners', 'productos', 'combos'];
const MAXIMO_BYTES = 2 * 1024 * 1024;
const UN_ANIO_EN_SEGUNDOS = '31536000';

function leerEntorno() {
  const texto = readFileSync(ARCHIVO_ENTORNO, 'utf8');
  const valor = (clave) => texto.match(new RegExp(`${clave}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`))?.[1];
  const supabaseUrl = valor('supabaseUrl');
  const supabaseKey = valor('supabaseKey');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(`No encontré supabaseUrl y supabaseKey en ${ARCHIVO_ENTORNO}.`);
  }

  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey };
}

function problemaDeRuta(ruta) {
  const partes = ruta.split('/');

  if (partes.length !== 2) {
    return 'tiene que estar dentro de una sola carpeta';
  }

  const [carpeta, nombre] = partes;

  if (!CARPETAS.includes(carpeta)) {
    return `la carpeta "${carpeta}" no está permitida en el bucket`;
  }

  if (!/^[a-z0-9-]+\.jpg$/.test(nombre)) {
    return 'el nombre tiene que ir en minúsculas, sin espacios ni tildes y terminar en .jpg';
  }

  return null;
}

function problemaDeContenido(contenido) {
  if (contenido.length === 0) {
    return 'el archivo está vacío';
  }

  if (contenido.length > MAXIMO_BYTES) {
    return 'pesa más de 2 MB, el máximo del bucket';
  }

  if (contenido[0] !== 0xff || contenido[1] !== 0xd8 || contenido[2] !== 0xff) {
    return 'no es un JPG válido';
  }

  return null;
}

function listarImagenes() {
  const imagenes = [];

  for (const carpeta of CARPETAS) {
    const directorio = join(CARPETA_IMAGENES, carpeta);
    let nombres;

    try {
      nombres = readdirSync(directorio).filter((nombre) => nombre.toLowerCase().endsWith('.jpg')).sort();
    } catch {
      imagenes.push({ ruta: `${carpeta}/`, contenido: null, problema: `no existe la carpeta ${directorio}` });
      continue;
    }

    for (const nombre of nombres) {
      const ruta = `${carpeta}/${nombre}`;
      const contenido = readFileSync(join(directorio, nombre));
      imagenes.push({ ruta, contenido, problema: problemaDeRuta(ruta) ?? problemaDeContenido(contenido) });
    }
  }

  return imagenes;
}

function yaExiste(error) {
  const codigos = [String(error.status ?? ''), String(error.statusCode ?? '')];
  return codigos.includes('409') || /already exists|duplicate/i.test(String(error.message ?? ''));
}

function tamanio(contenido) {
  return contenido ? `${Math.round(contenido.length / 1024)} KB` : '-';
}

function simular(imagenes, supabaseUrl) {
  const base = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`;
  const conProblemas = imagenes.filter((imagen) => imagen.problema);

  console.log('Simulación: no se conecta a Supabase ni sube nada.');
  console.log(`Bucket "${BUCKET}" en ${supabaseUrl}\n`);

  for (const imagen of imagenes) {
    if (imagen.problema) {
      console.log(`ERROR     ${imagen.ruta}: ${imagen.problema}`);
    } else {
      console.log(`subiría   ${imagen.ruta.padEnd(36)} ${tamanio(imagen.contenido).padStart(7)}  ->  ${base}${imagen.ruta}`);
    }
  }

  console.log(`\nSe subirían ${imagenes.length - conProblemas.length} imágenes. Con errores: ${conProblemas.length}.`);
  return conProblemas.length === 0;
}

async function subir(imagenes, { supabaseUrl, supabaseKey }) {
  const email = process.env.CINENOVA_ADMIN_EMAIL?.trim();
  const password = process.env.CINENOVA_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Faltan las variables de entorno CINENOVA_ADMIN_EMAIL y CINENOVA_ADMIN_PASSWORD con una cuenta de administrador.');
    console.error('Ejemplo: CINENOVA_ADMIN_EMAIL=... CINENOVA_ADMIN_PASSWORD=... node scripts/subir-imagenes-seed.mjs');
    return false;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { error: errorDeIngreso } = await supabase.auth.signInWithPassword({ email, password });
  if (errorDeIngreso) {
    console.error(`No se pudo ingresar con ${email}: ${errorDeIngreso.message}`);
    return false;
  }

  try {
    const { data: esAdmin, error: errorDeRol } = await supabase.rpc('es_admin');
    if (errorDeRol) {
      console.error(`No se pudo verificar el rol de ${email}: ${errorDeRol.message}`);
      return false;
    }

    if (esAdmin !== true) {
      console.error(`La cuenta ${email} no es administradora: el bucket solo acepta archivos de un admin.`);
      return false;
    }

    const almacen = supabase.storage.from(BUCKET);
    const resumen = { subidas: 0, yaEstaban: 0, errores: 0 };

    console.log(`Subiendo ${imagenes.length} imágenes al bucket "${BUCKET}" de ${supabaseUrl}\n`);

    for (const imagen of imagenes) {
      if (imagen.problema) {
        resumen.errores++;
        console.log(`ERROR      ${imagen.ruta}: ${imagen.problema}`);
        continue;
      }

      const { error } = await almacen.upload(imagen.ruta, imagen.contenido, {
        contentType: 'image/jpeg',
        cacheControl: UN_ANIO_EN_SEGUNDOS,
        upsert: false,
      });

      if (!error) {
        resumen.subidas++;
        console.log(`subida     ${imagen.ruta}`);
      } else if (yaExiste(error)) {
        resumen.yaEstaban++;
        console.log(`ya estaba  ${imagen.ruta}`);
      } else {
        resumen.errores++;
        console.log(`ERROR      ${imagen.ruta}: ${error.message}`);
      }
    }

    console.log(`\nSubidas: ${resumen.subidas}. Ya estaban: ${resumen.yaEstaban}. Errores: ${resumen.errores}.`);
    return resumen.errores === 0;
  } finally {
    await supabase.auth.signOut({ scope: 'local' });
  }
}

try {
  const entorno = leerEntorno();
  const imagenes = listarImagenes();

  if (imagenes.length === 0) {
    throw new Error(`no hay imágenes .jpg en ${CARPETA_IMAGENES}.`);
  }

  const ok = process.argv.includes('--simular') ? simular(imagenes, entorno.supabaseUrl) : await subir(imagenes, entorno);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(`No se pudieron subir las imágenes: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
