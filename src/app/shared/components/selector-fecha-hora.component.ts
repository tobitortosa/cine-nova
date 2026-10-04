import { Component, OnInit, computed, effect, input, model, signal } from '@angular/core';
import { DIAS_CORTOS, DIAS_LARGOS, MESES } from '../utils/calendario';

interface CeldaDia {
  clave: string;
  dia: number;
  delMes: boolean;
  deshabilitado: boolean;
  hoy: boolean;
}

@Component({
  selector: 'app-selector-fecha-hora',
  imports: [],
  templateUrl: './selector-fecha-hora.component.html',
  styleUrl: './selector-fecha-hora.component.scss',
})
export class SelectorFechaHoraComponent implements OnInit {
  readonly valor = model<string>('');
  readonly minimo = input<string>('');
  readonly etiqueta = input<string>('Fecha y hora');

  readonly meses = MESES;
  readonly diasCortos = DIAS_CORTOS;
  readonly diasLargos = DIAS_LARGOS;
  readonly horas: number[] = Array.from({ length: 24 }, (_, i) => i);
  readonly minutos: number[] = Array.from({ length: 12 }, (_, i) => i * 5);

  readonly anioVisible = signal(new Date().getFullYear());
  readonly mesVisible = signal(new Date().getMonth());
  readonly diaElegido = signal('');
  readonly horaElegida = signal(20);
  readonly minutoElegido = signal(0);

  private ultimoValor = '';

  readonly claveMinima = computed(() => {
    const texto = (this.minimo() ?? '').trim();
    return texto.length >= 10 ? texto.slice(0, 10) : '';
  });

  readonly horaMinima = computed(() => {
    const texto = (this.minimo() ?? '').trim();
    if (texto.length < 13) return 0;
    const numero = Number(texto.slice(11, 13));
    return Number.isFinite(numero) ? numero : 0;
  });

  readonly minutoMinimo = computed(() => {
    const texto = (this.minimo() ?? '').trim();
    if (texto.length < 16) return 0;
    const numero = Number(texto.slice(14, 16));
    return Number.isFinite(numero) ? Math.floor(numero / 5) * 5 : 0;
  });

  readonly puedeRetroceder = computed(() => {
    const minima = this.claveMinima();
    if (!minima) return true;
    return `${this.anioVisible()}-${this.dosDigitos(this.mesVisible() + 1)}` > minima.slice(0, 7);
  });

  readonly celdas = computed<CeldaDia[]>(() => {
    const anio = this.anioVisible();
    const mes = this.mesVisible();
    const corrimiento = (new Date(anio, mes, 1).getDay() + 6) % 7;
    const totalDias = new Date(anio, mes + 1, 0).getDate();
    const cantidad = Math.ceil((corrimiento + totalDias) / 7) * 7;
    const minima = this.claveMinima();
    const hoy = this.claveDe(new Date());
    const lista: CeldaDia[] = [];

    for (let i = 0; i < cantidad; i++) {
      const fecha = new Date(anio, mes, 1 - corrimiento + i);
      const clave = this.claveDe(fecha);
      lista.push({
        clave,
        dia: fecha.getDate(),
        delMes: fecha.getMonth() === mes,
        deshabilitado: minima !== '' && clave < minima,
        hoy: clave === hoy,
      });
    }

    return lista;
  });

  readonly resumen = computed(() => {
    const clave = this.diaElegido();
    if (!clave) return 'Elegí un día y un horario';

    const fecha = new Date(
      Number(clave.slice(0, 4)),
      Number(clave.slice(5, 7)) - 1,
      Number(clave.slice(8, 10)),
    );
    const texto = `${this.diasLargos[fecha.getDay()]} ${fecha.getDate()} de ${this.meses[fecha.getMonth()]} de ${fecha.getFullYear()}`;
    const hora = `${this.dosDigitos(this.horaElegida())}:${this.dosDigitos(this.minutoElegido())}`;
    return `${texto.charAt(0).toUpperCase()}${texto.slice(1)} · ${hora} h`;
  });

  constructor() {
    effect(() => {
      const entrante = this.valor();
      if (entrante === this.ultimoValor) return;
      this.ultimoValor = entrante;
      this.leer(entrante);
    });
  }

  ngOnInit(): void {
    const actual = this.valor();
    if (actual) {
      this.ultimoValor = actual;
      this.leer(actual);
      return;
    }
    const base = this.claveMinima();
    if (base) {
      this.anioVisible.set(Number(base.slice(0, 4)));
      this.mesVisible.set(Number(base.slice(5, 7)) - 1);
    }
  }

  dosDigitos(valor: number): string {
    return valor < 10 ? `0${valor}` : `${valor}`;
  }

  horaDeshabilitada(hora: number): boolean {
    const minima = this.claveMinima();
    if (!minima || this.diaElegido() !== minima) return false;
    return hora < this.horaMinima();
  }

  minutoDeshabilitado(minuto: number): boolean {
    const minima = this.claveMinima();
    if (!minima || this.diaElegido() !== minima) return false;
    if (this.horaElegida() !== this.horaMinima()) return false;
    return minuto < this.minutoMinimo();
  }

  mesAnterior(): void {
    if (!this.puedeRetroceder()) return;
    if (this.mesVisible() === 0) {
      this.anioVisible.update((anio) => anio - 1);
      this.mesVisible.set(11);
      return;
    }
    this.mesVisible.update((mes) => mes - 1);
  }

  mesSiguiente(): void {
    if (this.mesVisible() === 11) {
      this.anioVisible.update((anio) => anio + 1);
      this.mesVisible.set(0);
      return;
    }
    this.mesVisible.update((mes) => mes + 1);
  }

  irAHoy(): void {
    const hoy = new Date();
    this.anioVisible.set(hoy.getFullYear());
    this.mesVisible.set(hoy.getMonth());
  }

  elegirDia(celda: CeldaDia): void {
    if (celda.deshabilitado) return;
    this.diaElegido.set(celda.clave);
    this.anioVisible.set(Number(celda.clave.slice(0, 4)));
    this.mesVisible.set(Number(celda.clave.slice(5, 7)) - 1);
    this.ajustar();
    this.emitir();
  }

  elegirHora(hora: number): void {
    if (this.horaDeshabilitada(hora)) return;
    this.horaElegida.set(hora);
    this.ajustar();
    this.emitir();
  }

  elegirMinuto(minuto: number): void {
    if (this.minutoDeshabilitado(minuto)) return;
    this.minutoElegido.set(minuto);
    this.emitir();
  }

  private ajustar(): void {
    if (this.diaElegido() !== this.claveMinima()) return;
    if (this.horaElegida() < this.horaMinima()) {
      this.horaElegida.set(this.horaMinima());
      this.minutoElegido.set(this.minutoMinimo());
      return;
    }
    if (this.horaElegida() === this.horaMinima() && this.minutoElegido() < this.minutoMinimo()) {
      this.minutoElegido.set(this.minutoMinimo());
    }
  }

  private emitir(): void {
    const dia = this.diaElegido();
    const compuesto = dia
      ? `${dia}T${this.dosDigitos(this.horaElegida())}:${this.dosDigitos(this.minutoElegido())}`
      : '';
    this.ultimoValor = compuesto;
    this.valor.set(compuesto);
  }

  private leer(texto: string): void {
    const limpio = (texto ?? '').trim();
    const anio = Number(limpio.slice(0, 4));
    const mes = Number(limpio.slice(5, 7));
    const dia = Number(limpio.slice(8, 10));

    if (limpio.length < 16 || !Number.isFinite(anio) || !mes || !dia) {
      this.diaElegido.set('');
      return;
    }

    const hora = Number(limpio.slice(11, 13));
    const minuto = Number(limpio.slice(14, 16));

    this.anioVisible.set(anio);
    this.mesVisible.set(mes - 1);
    this.diaElegido.set(limpio.slice(0, 10));
    this.horaElegida.set(Number.isFinite(hora) ? Math.min(23, Math.max(0, hora)) : 0);
    this.minutoElegido.set(
      Number.isFinite(minuto) ? Math.min(55, Math.max(0, Math.round(minuto / 5) * 5)) : 0,
    );
  }

  private claveDe(fecha: Date): string {
    return `${fecha.getFullYear()}-${this.dosDigitos(fecha.getMonth() + 1)}-${this.dosDigitos(fecha.getDate())}`;
  }
}
