"use client";

import { useState } from "react";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

interface Props {
  name: string;
  defaultValue?: string;
  options: SelectOption[];
  placeholder?: string;
}

const SearchableSelectFilter = ({ name, defaultValue = "", options, placeholder }: Props) => {
  const [value, setValue] = useState(defaultValue);

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <SearchableSelect
        options={options}
        value={value}
        onChange={setValue}
        placeholder={placeholder}
      />
    </>
  );
};

export default SearchableSelectFilter;
