import type { SearchCriteria } from "@/lib/search-params";

/** Filter fields rendered inside the search page's GET form. */
export function SearchFilters({
  criteria,
  categories,
  seatOptions,
}: {
  criteria: SearchCriteria;
  categories: { code: string; name: string }[];
  seatOptions: number[];
}) {
  return (
    <div className="space-y-4" data-testid="search-filters">
      <div>
        <label htmlFor="f-category" className="label">
          Category
        </label>
        <select id="f-category" name="category" defaultValue={criteria.category ?? ""} className="input" data-testid="filter-category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-transmission" className="label">
          Transmission
        </label>
        <select id="f-transmission" name="transmission" defaultValue={criteria.transmission ?? ""} className="input" data-testid="filter-transmission">
          <option value="">Any</option>
          <option value="AUTOMATIC">Automatic</option>
          <option value="MANUAL">Manual</option>
        </select>
      </div>
      <div>
        <label htmlFor="f-seats" className="label">
          Seats (minimum)
        </label>
        <select id="f-seats" name="seats" defaultValue={criteria.seats ? String(criteria.seats) : ""} className="input" data-testid="filter-seats">
          <option value="">Any</option>
          {seatOptions.map((s) => (
            <option key={s} value={s}>
              {s}+
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-fuel" className="label">
          Fuel type
        </label>
        <select id="f-fuel" name="fuel" defaultValue={criteria.fuel ?? ""} className="input" data-testid="filter-fuel">
          <option value="">Any</option>
          <option value="PETROL">Petrol</option>
          <option value="DIESEL">Diesel</option>
          <option value="HYBRID">Hybrid</option>
          <option value="ELECTRIC">Electric</option>
        </select>
      </div>
      <fieldset>
        <legend className="label">Price per day (AED)</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="f-min" className="sr-only">
              Minimum price per day
            </label>
            <input id="f-min" name="minPrice" type="number" min={0} step={1} inputMode="numeric" placeholder="Min" defaultValue={criteria.minPrice ?? ""} className="input" data-testid="filter-min-price" />
          </div>
          <div>
            <label htmlFor="f-max" className="sr-only">
              Maximum price per day
            </label>
            <input id="f-max" name="maxPrice" type="number" min={0} step={1} inputMode="numeric" placeholder="Max" defaultValue={criteria.maxPrice ?? ""} className="input" data-testid="filter-max-price" />
          </div>
        </div>
      </fieldset>
      <div>
        <label htmlFor="f-sort" className="label">
          Sort by
        </label>
        <select id="f-sort" name="sort" defaultValue={criteria.sort ?? "price"} className="input" data-testid="sort">
          <option value="price">Price: low to high</option>
          <option value="-price">Price: high to low</option>
        </select>
      </div>
    </div>
  );
}
