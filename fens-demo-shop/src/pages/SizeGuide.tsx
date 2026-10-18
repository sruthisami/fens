import { SIZE_COLUMNS, SIZE_ROWS } from '../data/sizes';
export function SizeGuide() {
  return (
    <section>
      <h1>Size guide</h1>
      <p>Fence shoes fit true to size. Between sizes? Take the larger one.</p>
      <table className="size-table" data-component="SizeTable">
        <caption>Shoe sizes in US, UK, EU and Japanese sizing, with foot length</caption>
        <thead>
          <tr>
            {SIZE_COLUMNS.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SIZE_ROWS.map(([first, ...rest]) => (
            <tr key={first}>
              <th scope="row">{first}</th>
              {rest.map((value, i) => (
                <td key={SIZE_COLUMNS[i + 1]}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <h2>How to measure</h2>
      <p>
        Stand on a sheet of paper, mark your heel and your longest toe, and measure between the
        marks. Find that length in the foot length columns.
      </p>
    </section>
  );
}
