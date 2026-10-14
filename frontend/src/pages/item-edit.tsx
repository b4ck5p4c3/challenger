import { useNavigate, useParams } from "react-router"
import { getItem, updateItem } from "../utils/api"
import { InputText } from "../components/input-text"
import styles from "./item-edit.module.css"
import { Button } from "../components/button"
import z from "zod"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState } from "react"

const itemEditFormSchema = z.object({
  brand: z.string().nonempty(),
  name: z.string().nonempty(),
  volume: z.string().nonempty().refine(value => Number.parseFloat(value) > 0),
  caffeine: z.string().nonempty().refine(value => Number.parseFloat(value) >= 0),
  alcohol: z.string().nonempty().refine(value => Number.parseFloat(value) >= 0),
})

export function ItemEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [isPending, setPending] = useState(true)

  const form = useForm<z.infer<typeof itemEditFormSchema>>({
    resolver: zodResolver(itemEditFormSchema),
    disabled: isPending, 
    defaultValues: {
      brand: "",
      name: "",
      volume: "0",
      caffeine: "0",
      alcohol: "0",
    },
  })

  const [alcoholPercent, setAlcoholPercent] = useState("0")
  const [caffeineConcentration, setCaffeineConcentration] = useState("0")

  useEffect(() => {
    async function fetchItem() {
      const item = await getItem(id!)
      if (!item) {
        navigate('/products')
        return
      }
      form.reset({
        ...item,
        volume: item.volume.toString(),
        caffeine: item.caffeine.toString(),
        alcohol: item.alcohol.toString()
      })
      setAlcoholPercent((item.alcohol / Math.max(1, item.volume) * 100).toString())
      setCaffeineConcentration((item.caffeine / Math.max(1, item.volume) * 100).toString())
      setPending(false)
    }
    fetchItem().catch(error => { alert(String(error)); setPending(false) })
  }, [id, navigate, form])

  function onSubmit(data: z.infer<typeof itemEditFormSchema>) {
    setPending(true)
    updateItem(id!, {
      ...data,
      alcohol: Number.parseFloat(data.alcohol),
      volume: Number.parseFloat(data.volume),
      caffeine: Number.parseFloat(data.caffeine)
    }).catch(error => alert(String(error))).finally(() => setPending(false))
  }
  

  return <> 
    <div className={styles.headerString}>
      <h3>Item edit</h3>
    </div>
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <div className={styles.inputRow}>
        <div>Brand:</div>
        <div className={styles.inputRowInput}>
          <Controller name={"brand"} control={form.control} render={({ field, fieldState }) => 
            <InputText className={`${styles.inputLeft} 
            ${fieldState.invalid ? styles.inputInvalid : ''}`} {...field}/>}/>
        </div>
      </div>
      <div className={styles.inputRow}>
        <div>Name:</div>
        <div className={styles.inputRowInput}>
          <Controller name={"name"} control={form.control} render={({ field, fieldState }) => 
            <InputText className={`${styles.inputLeft} 
            ${fieldState.invalid ? styles.inputInvalid : ''}`} {...field}/>}/>
        </div>
      </div>
      <div className={styles.inputRow}>
        <div>Volume:</div>
        <div className={styles.inputRowInput}>
          <Controller name={"volume"} control={form.control} render={({ field, fieldState }) => 
            <InputText className={`${styles.inputRight} 
            ${fieldState.invalid ? styles.inputInvalid : ''}`} {...field}/>}/>
          <div>ml</div>
        </div>
      </div>
      <div className={styles.inputRow}>
        <div>Caffeine:</div>
        <div className={styles.inputRowInput}>
          <InputText className={styles.inputRight} value={caffeineConcentration} 
            onChange={e => setCaffeineConcentration(e.target.value)}/>
          <div>mg per 100ml <Button className={styles.buttonEquals} onClick={(e) => {
            e.preventDefault()
            const volume = Number.parseFloat(form.getValues().volume)
            const caffeine = Number.parseFloat(caffeineConcentration)
            if (Number.isNaN(caffeine) || Number.isNaN(volume)) {
              return
            }
            form.setValue('caffeine', (volume * caffeine / 100).toString())
          }}>=&gt;</Button> </div>
          <Controller name={"caffeine"} control={form.control} render={({ field, fieldState }) => 
            <InputText className={`${styles.inputRight} 
            ${fieldState.invalid ? styles.inputInvalid : ''}`} {...field}/>}/>
          <div>mg</div>
        </div>
      </div>
      <div className={styles.inputRow}>
        <div>Alcohol:</div>
        <div className={styles.inputRowInput}>
          <InputText className={styles.inputRight} value={alcoholPercent} 
            onChange={e => setAlcoholPercent(e.target.value)}/>
          <div>% <Button className={styles.buttonEquals} onClick={(e) => {
            e.preventDefault()
            const volume = Number.parseFloat(form.getValues().volume)
            const alcohol = Number.parseFloat(alcoholPercent)
            if (Number.isNaN(alcohol) || Number.isNaN(volume)) {
              return
            }
            form.setValue('alcohol', (volume * alcohol / 100).toString())
          }}>=&gt;</Button> </div>
          <Controller name={"alcohol"} control={form.control} render={({ field, fieldState }) => 
            <InputText className={`${styles.inputRight} 
            ${fieldState.invalid ? styles.inputInvalid : ''}`} {...field}/>}/>
          <div>ml</div>
        </div>
      </div>
      <Button type={"submit"} className={styles.buttonSave}>Save</Button>
    </form>
  </>
}
