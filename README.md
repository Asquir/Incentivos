# Mis Incentivos

Aplicación web para apuntar ventas y calcular el incentivo mensual según la
fórmula de incentivos de la empresa ("Resumen nueva fórmula de incentivos").

Es un único fichero (`index.html`) sin dependencias: funciona abriéndolo en
cualquier navegador, en el móvil o en el ordenador. Los datos se guardan en el
propio dispositivo (localStorage), no salen a ningún servidor.

## Cómo funciona el cálculo

El incentivo se calcula en 3 partes encadenadas:

**Parte 1 · Cuantitativa (ventas)** — la facturación del mes × un porcentaje
según tramo:

| Nivel | Facturación | % |
|---|---|---|
| 1 | 0 – 5.000 € | 0,00 % |
| 2 | 5.001 – 20.000 € | 0,10 % |
| 3 | 20.001 – 46.000 € | 0,15 % |
| 4 | 46.001 – 70.000 € | 0,25 % |
| 5 | 70.001 € o más | 0,30 % |

**Parte 2 · Cualitativa (score)** — el resultado anterior × un multiplicador
según el score acumulado:

| Nivel | Score | Multiplicador |
|---|---|---|
| 1 | 0 – 100 | × 1,00 |
| 2 | 101 – 250 | × 1,50 |
| 3 | 251 – 375 | × 2,25 |
| 4 | 376 – 500 | × 2,50 |
| 5 | 501 o más | × 3,00 |

**Parte 3 · Attach CARE y SEGUROS** — dos multiplicadores más, uno por el % de
attach de CARE y otro por el de SEGUROS:

| Tramo | Attach | Multiplicador |
|---|---|---|
| 1 | menos del 25 % | × 0,25 |
| 2 | 25 % – 45 % | × 0,75 |
| 3 | 45 % o más | × 1,35 |

> Nota: el ejemplo del email sitúa el 45 % exacto en el tramo alto
> (45 % de seguros → × 1,35), así que la app hace lo mismo.

Ejemplo verificado contra el email: 55.000 € → 137,50 € → × 2,25 (346 score)
= 309,37 € → × 1,35 × 1,35 = **563,83 €**.

El % de attach se calcula automáticamente como *ventas con CARE (o SEGURO) ÷
ventas totales del mes*. Si el número no cuadra con el del sistema, el ✎ de
esas dos fichas pide **cuántos CARE o seguros llevas** y **cuántas unidades
centrales** — números, no un porcentaje: el % lo calcula la app y lo enseña
mientras se escribe. Las unidades centrales son el divisor de las dos fichas,
así que se escriben una vez y valen para CARE y para seguros. Lo mismo vale
para la facturación y el score: con el ✎ de su ficha se escribe la cifra del
sistema.
Esa cifra no se queda congelada, es el **punto de partida**: lo que se apunte
después se le sigue sumando (y lo que se borre, restando). Al volver a abrir
el ✎ aparece la cifra de ese momento, para corregir sobre ella. Dejando el
campo vacío se vuelve a la suma limpia de los apuntes.

## Funciones

- Alta de venta en segundos: importe, score y botones CARE / SEGURO.
- **IVA**: el buscador y el ticket enseñan el precio real (el que paga el
  cliente) y a facturación va el importe **sin IVA**, que es como lo cuenta la
  empresa. Debajo del importe se ve siempre lo que se va a registrar. Los
  seguros (AppleCare, Insurama) están exentos y cuentan enteros. El porcentaje
  se cambia en Ajustes y con 0 se desactiva. Cada venta guarda también el
  bruto, así que al editarla vuelve el precio con IVA y no se descuenta dos
  veces.
- Buscador con el catálogo de la empresa (2.149 servicios y accesorios con su
  precio y su score): al elegir un producto rellena importe, score y nota.
  Entiende las abreviaturas de tienda (buscar "funda" encuentra "FUN IPH16…")
  y coloca arriba lo que más apuntas.
- Búsqueda por SKU: están los 2.197 SKU del Excel, incluidos los de la tarifa
  Retail POS y los de las referencias que comparten nombre. Al buscar por
  referencia el resultado enseña cuál ha encontrado.
- Los productos propios (móviles, Macs… que no vienen en el Excel) pueden
  llevar también su SKU. Si lo que se escribe en el buscador parece una
  referencia, al crear el producto ya va puesta en su sitio. En Ajustes se
  tocan para editarlos.
- Apunte de **accesorios**: suman a facturación y score, pero quedan fuera del
  cálculo de los porcentajes de attach (no los diluyen) y no admiten
  CARE ni seguro.
- Incentivo estimado siempre visible, con el desglose del cálculo.
- Media diaria de facturación bajo el incentivo, en cualquier mes (también en
  los cerrados). Con un objetivo puesto, al lado aparece el ritmo que haría
  falta, así se ve de un vistazo lo que se lleva y lo que falta.
- Proyección a fin de mes: "a este ritmo acabarás el mes con ~X €". Cuenta
  **días de trabajo, no de calendario**: en Ajustes se indica cuántos días se
  libran a la semana (2 por defecto) y tanto la proyección como el "€ al día"
  del objetivo descuentan los que no se trabaja.
- "Lo que tienes más cerca": hasta tres movimientos que suben de tramo
  (facturación, score, CARE o seguros) con el incentivo que dejarían, y
  ordenados por esfuerzo, no por lo que dan. Para comparar euros con puntos y
  con servicios, cada uno se mide en ventas medias propias.
- Aviso de riesgo: cuando quedan una o ninguna venta de margen antes de
  caer de tramo de attach, avisa y cifra lo que se perdería. Las fichas
  de CARE y seguros muestran siempre el margen disponible
  ("aguantas 3 ventas sin CARE").
- Progreso hacia el siguiente tramo de facturación, score y attach.
- Historial por meses (navegación ‹ ›), lista de ventas por día y total
  estimado del año.
- Editar ventas, y borrar con botón Deshacer.
- Compartir el resumen del mes (hoja de compartir de iOS / WhatsApp).
- Exportar / importar copia de seguridad en JSON.
- Funciona sin conexión una vez instalada (service worker), con icono
  propio en la pantalla de inicio.
- Gráfica de evolución de los últimos 6 meses (tocar una barra abre ese mes).
- Ajustes con las tablas de la fórmula editables, por si la empresa las
  cambia, más el multiplicador colectivo de la Parte 4 (pendiente de
  aplicar por la empresa; se deja en 1 hasta que lo comuniquen).

## Aviso importante sobre los datos

Safari borra el almacenamiento de una web tras varios días sin visitarla.
**Instalada en la pantalla de inicio esto no ocurre**, así que la app muestra
un aviso recordándolo mientras no esté instalada, y recuerda hacer una copia
si hace más de 30 días de la última.

## Publicar gratis para todo el equipo (GitHub Pages)

1. En GitHub: **Settings → Pages → Deploy from a branch**, elegir la rama y
   carpeta `/ (root)` y guardar.
2. La app queda en `https://<usuario>.github.io/Incentivos/`.
3. Cada persona la abre en su móvil y usa **Compartir → Añadir a pantalla de
   inicio**. Los datos de cada uno se guardan solo en su dispositivo.

## Uso en el móvil

Abrir la página y usar "Añadir a pantalla de inicio" (Compartir → Añadir a
pantalla de inicio en iPhone) para tenerla como una app más, con icono
propio y a pantalla completa.
